import React from 'react';

// Only the small Markdown subset used by the editorial content is supported.
// Text remains escaped by React; links must use HTTP(S).
export function ArticleInline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g).map((part, i) => {
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (link)
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>
          );
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

export function ArticleText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i} className={paragraph.startsWith('**') ? 'guide-checklist' : undefined}>
            <ArticleInline text={paragraph} />
          </p>
        ))}
    </>
  );
}
