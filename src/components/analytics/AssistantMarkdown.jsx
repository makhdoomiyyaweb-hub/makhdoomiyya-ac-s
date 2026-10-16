import { Fragment } from 'react';

function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function getTableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isListItem(line) {
  return /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
}

function renderBlocks(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && lines[index].includes('|') && isTableDivider(lines[index + 1])) {
      const headers = getTableCells(lines[index]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(getTableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="assistant-markdown-table-wrap" key={`table-${blocks.length}`}>
          <table className="assistant-markdown-table">
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `th-${blocks.length}-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headers.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] || '', `td-${blocks.length}-${rowIndex}-${cellIndex}`)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (isListItem(lines[index])) {
      const ordered = /^\s*\d+[.)]\s+/.test(lines[index]);
      const items = [];
      while (index < lines.length && isListItem(lines[index]) && /^\s*\d+[.)]\s+/.test(lines[index]) === ordered) {
        items.push(lines[index].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List className="assistant-markdown-list" key={`list-${blocks.length}`}>
        {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `li-${blocks.length}-${itemIndex}`)}</li>)}
      </List>);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isListItem(lines[index])) {
      if (index + 1 < lines.length && lines[index].includes('|') && isTableDivider(lines[index + 1])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length) {
      blocks.push(<p className="assistant-markdown-paragraph" key={`p-${blocks.length}`}>
        {paragraph.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line.replace(/^#{1,6}\s+/, ''), `p-${blocks.length}-${lineIndex}`)}</Fragment>)}
      </p>);
    }
  }

  return blocks;
}

export default function AssistantMarkdown({ children }) {
  return <div className="assistant-markdown">{renderBlocks(children)}</div>;
}
