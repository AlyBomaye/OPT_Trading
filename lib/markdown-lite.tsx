import React from 'react';
import Link from 'next/link';

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseInline(text: string): React.ReactNode[] {
  // Regex para achar links [text](url) e código `code` e negrito **bold** e itálico *italics*
  const tokenRegex = /(\[.*?\]\(.*?\)|\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
  const parts = text.split(tokenRegex);
  
  return parts.map((part, i) => {
    if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        const [, linkText, href] = match;
        // Escape href to prevent js injection (javascript:)
        if (href.trim().toLowerCase().startsWith("javascript:")) {
          return <span key={i}>{escapeHtml(linkText)}</span>;
        }
        return (
          <Link key={i} href={href} className="text-blue-400 hover:underline">
            {escapeHtml(linkText)}
          </Link>
        );
      }
    }
    
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{escapeHtml(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{escapeHtml(part.slice(1, -1))}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-gray-800 px-1 py-0.5 rounded text-sm text-pink-400">{escapeHtml(part.slice(1, -1))}</code>;
    }
    return <React.Fragment key={i}>{escapeHtml(part)}</React.Fragment>;
  });
}

export function MarkdownLite({ text }: { text: string }) {
  if (!text) return null;
  
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  
  let listItems: React.ReactNode[] = [];
  let isList = false;

  const flushList = () => {
    if (isList && listItems.length > 0) {
      elements.push(<ul key={`ul-${elements.length}`} className="list-disc pl-5 mb-4 space-y-1 text-gray-300">{listItems}</ul>);
      listItems = [];
      isList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === '') {
      flushList();
      continue;
    }

    if (line.startsWith('### ')) {
      flushList();
      elements.push(<h3 key={i} className="text-lg font-bold text-gray-200 mt-4 mb-2">{parseInline(line.slice(4))}</h3>);
      continue;
    }
    
    if (line.startsWith('## ')) {
      flushList();
      elements.push(<h2 key={i} className="text-xl font-bold text-gray-100 mt-5 mb-3">{parseInline(line.slice(3))}</h2>);
      continue;
    }
    
    if (line.startsWith('# ')) {
      flushList();
      elements.push(<h1 key={i} className="text-2xl font-bold text-white mt-6 mb-4">{parseInline(line.slice(2))}</h1>);
      continue;
    }

    if (line.startsWith('- ')) {
      isList = true;
      listItems.push(<li key={i}>{parseInline(line.slice(2))}</li>);
      continue;
    }
    
    if (/^\d+\.\s/.test(line)) {
      isList = true;
      const match = line.match(/^\d+\.\s(.*)/);
      if (match) {
        listItems.push(<li key={i}>{parseInline(match[1])}</li>);
      }
      continue;
    }
    
    if (line === '---') {
      flushList();
      elements.push(<hr key={i} className="border-gray-700 my-4" />);
      continue;
    }

    flushList();
    elements.push(<p key={i} className="mb-4 text-gray-300 leading-relaxed">{parseInline(line)}</p>);
  }
  
  flushList();

  return <div className="markdown-lite">{elements}</div>;
}
