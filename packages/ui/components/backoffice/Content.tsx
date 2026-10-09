'use client';
import { useState } from 'react';
import { Row, Field, CheckField, Badge } from '../shared';

export function OperatorContent({
  d,
  mutation,
  editArticle,
  setEditArticle,
}: {
  d: Row;
  mutation: (path: string, body: Row, method?: string) => Promise<unknown>;
  editArticle: string | null;
  setEditArticle: (id: string | null) => void;
}) {
  return (
    <div className="stack">
      <h2>Treści, które pomagają ruszyć.</h2>
      {d.articles.map((a: Row) => (
        <div className="panel" key={a.id}>
          <div className="spread">
            <h3>{a.title}</h3>
            <Badge status={a.published ? 'published' : 'draft'} />
          </div>
          {editArticle === a.id ? (
            <ArticleEditor
              a={a}
              save={async (body: Row) => {
                const result = await mutation('/articles/' + a.id, body, 'PATCH');
                if (result !== undefined) setEditArticle(null);
              }}
            />
          ) : (
            <>
              <p className="small muted">{a.summary}</p>
              <button className="btn secondary compact" onClick={() => setEditArticle(a.id)}>
                Edytuj artykuł
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
function ArticleEditor({ a, save }: { a: Row; save: (d: Row) => void }) {
  const [body, setBody] = useState<string[][]>(a.body);
  return (
    <form
      className="stack section-top"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          title: f.get('title'),
          summary: f.get('summary'),
          kind: f.get('kind'),
          body,
          published: f.get('published') === 'on',
        });
      }}
    >
      <Field label="Tytuł">
        <input
          className="input"
          name="title"
          defaultValue={a.title}
          required
          minLength={5}
          maxLength={160}
        />
      </Field>
      <Field label="Krótki opis">
        <textarea
          className="input"
          name="summary"
          defaultValue={a.summary}
          required
          minLength={10}
          maxLength={500}
        />
      </Field>
      <Field label="Rodzaj treści">
        <select className="input" name="kind" defaultValue={a.kind}>
          <option value="inspiration">Inspiracja</option>
          <option value="guide">Poradnik</option>
        </select>
      </Field>
      {body.map(([h, p], i) => (
        <div className="stack article-part" key={i}>
          <Field label={'Śródtytuł ' + (i + 1)}>
            <input
              className="input"
              value={h}
              required
              minLength={2}
              maxLength={150}
              onChange={(e) => setBody(body.map((x, j) => (i === j ? [e.target.value, x[1]] : x)))}
            />
          </Field>
          <Field label="Akapit">
            <textarea
              className="input tall"
              value={p}
              required
              minLength={5}
              maxLength={3000}
              onChange={(e) => setBody(body.map((x, j) => (i === j ? [x[0], e.target.value] : x)))}
            />
          </Field>
          <button
            className="text-link"
            type="button"
            disabled={body.length === 1}
            onClick={() => setBody(body.filter((_, j) => j !== i))}
          >
            Usuń sekcję
          </button>
        </div>
      ))}
      <button
        className="btn secondary"
        type="button"
        disabled={body.length >= 20}
        onClick={() => setBody([...body, ['', '']])}
      >
        Dodaj sekcję
      </button>
      <CheckField label="Opublikowany w serwisie" name="published" defaultChecked={a.published} />
      <button className="btn primary">Zapisz artykuł</button>
    </form>
  );
}
