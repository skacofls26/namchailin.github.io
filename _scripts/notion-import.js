const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

function escapeCodeBlock(body) {
  const regex = /```([\s\S]*?)```/g;
  return body.replace(regex, function (match, htmlBlock) {
    return '{% raw %}\n' + '```' + htmlBlock + '```' + '\n{% endraw %}';
  });
}

function replaceTitleOutsideRawBlocks(body) {
  const rawBlocks = [];
  const placeholder = '%%RAW_BLOCK%%';

  body = body.replace(/{% raw %}[\s\S]*?{% endraw %}/g, (match) => {
    rawBlocks.push(match);
    return placeholder;
  });

  const regex = /\n#[^\n]+\n/g;
  body = body.replace(regex, function (match) {
    return '\n' + match.replace('\n#', '\n##');
  });

  rawBlocks.forEach((block) => {
    body = body.replace(placeholder, block);
  });

  return body;
}

// passing notion client to the option
const n2m = new NotionToMarkdown({ notionClient: notion });

(async () => {
  // ensure directory exists
  const root = '_posts';
  fs.mkdirSync(root, { recursive: true });

  const databaseId = process.env.DATABASE_ID;
  let response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: '배포',
      checkbox: {
        equals: true,
      },
    },
  });

  const pages = response.results;
  while (response.has_more) {
    const nextCursor = response.next_cursor;
    response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: nextCursor,
      filter: {
        property: '배포',
        checkbox: {
          equals: true,
        },
      },
    });
    pages.push(...response.results);
  }

  for (const r of pages) {
    const id = r.id;

    // date
    let date = moment(r.created_time).format('YYYY-MM-DD');
    let fullDate = moment(r.created_time)
      .utcOffset('+0900')
      .format('YYYY-MM-DD HH:mm:ss Z');
    let pdate = r.properties?.['날짜']?.['date']?.['start'];
    if (pdate) {
      date = moment(pdate).format('YYYY-MM-DD');
      fullDate = moment(pdate)
        .utcOffset('+0900')
        .format('YYYY-MM-DD HH:mm:ss Z');
    }

    // title
    let title = id;
    let ptitle = r.properties?.['게시물']?.['title'];
    if (ptitle?.length > 0) {
      title = ptitle[0]?.['plain_text'];
    }

    // tags
    let tags = [];
    let ptags = r.properties?.['태그']?.['multi_select'];
    for (const t of ptags) {
      const n = t?.['name'];
      if (n) {
        tags.push(n);
      }
    }

    // categories
    let cats = [];
    let pcats = r.properties?.['카테고리']?.['multi_select'];
    for (const t of pcats) {
      const n = t?.['name'];
      if (n) {
        cats.push(n);
      }
    }

    // author
    let author = '';
    let pauthor = r.properties?.['저자']?.['rich_text'];
    if (pauthor?.length > 0) {
      author = pauthor[0]?.['plain_text'];
    }

    // description
    let description = '';
    let pdesc = r.properties?.['설명']?.['rich_text'];
    if (pdesc?.length > 0) {
      description = pdesc[0]?.['plain_text'];
    }

    // toc
    let toc = '';
    let ptoc = r.properties?.['TOC']?.['checkbox'];
    if (ptoc === false) {
      toc = 'toc: false\n';
    }

    // comments
    let comments = '';
    let pcomments = r.properties?.['댓글']?.['checkbox'];
    if (pcomments === false) {
      comments = 'comments: false\n';
    }

    // image (header image)
    let image = '';
    let pimage = r.properties?.['헤더 이미지']?.['files'];
    if (pimage?.length > 0) {
      const imgUrl =
        pimage[0]?.['file']?.['url'] || pimage[0]?.['external']?.['url'];
      if (imgUrl) {
        image = `image:\n  path: ${imgUrl}\n  alt: "${title}"\n`;
      }
    }

    // math
    let math = '';
    let pmath = r.properties?.['수학']?.['checkbox'];
    if (pmath === true) {
      math = 'math: true\n';
    }

    // mermaid
    let mermaid = '';
    let pmermaid = r.properties?.['머메이드']?.['checkbox'];
    if (pmermaid === true) {
      mermaid = 'mermaid: true\n';
    }

    // pin
    let pin = '';
    let ppin = r.properties?.['고정']?.['checkbox'];
    if (ppin === true) {
      pin = 'pin: true\n';
    }

    // frontmatter
    let fmtags = tags.length > 0 ? '[' + tags.join(', ') + ']' : '';
    let fmcats = cats.length > 0 ? '[' + cats.join(', ') + ']' : '';
    let fmauthor = author ? `author: "${author}"\n` : '';

    const fm = `---
title: "${title}"
date: ${fullDate}
categories: ${fmcats}
tags: ${fmtags}
description: "${description}"
${fmauthor}${toc}${comments}${image}${math}${mermaid}${pin}---

<br><br>
`;

    const mdblocks = await n2m.pageToMarkdown(id);
    let body = n2m.toMarkdownString(mdblocks)['parent'];

    if (body === '') {
      continue;
    }

    body = escapeCodeBlock(body);
    body = replaceTitleOutsideRawBlocks(body);

    // sanitize title for filename
    const sanitizedTitle = title
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '')
      .replace(/\s+/g, '-');
    const ftitle = `${date}-${sanitizedTitle}.md`;

    let index = 0;
    let edited_md = body.replace(
      /!\[(.*?)\]\((.*?)\)/g,
      function (match, p1, p2) {
        const dirname = path.join(
          'assets',
          'img',
          'posts',
          ftitle.replace('.md', '')
        );
        if (!fs.existsSync(dirname)) {
          fs.mkdirSync(dirname, { recursive: true });
        }

        const filename = path.join(dirname, `${index}.png`);
        axios({
          method: 'get',
          url: p2,
          responseType: 'stream',
        })
          .then(function (response) {
            let file = fs.createWriteStream(filename);
            response.data.pipe(file);
          })
          .catch(function (error) {
            console.log(error);
          });

        let res;
        if (p1 === '') res = '';
        else res = `_${p1}_`;

        return `![${index++}](${filename})${res}`;
      }
    );

    // writing to file
    fs.writeFile(path.join(root, ftitle), fm + edited_md, (err) => {
      if (err) {
        console.log(err);
      }
    });
  }
})();
