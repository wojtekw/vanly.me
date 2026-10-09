'use client';
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Clock, CheckCircle2 } from 'lucide-react';
import { Row, useApp, useData, DataState, Field, Notice, Empty } from '../../components/shared';

export function ConversationStatus({ status }: { status: string }) {
  const resolved = status === 'resolved',
    needsReply = status === 'needs_reply',
    Icon = resolved ? CheckCircle2 : needsReply ? MessageCircle : Clock;
  return (
    <span className={'conversation-status ' + status}>
      <Icon size={14} aria-hidden="true" />
      {resolved ? 'Rozwiązana' : needsReply ? 'Wymaga odpowiedzi' : 'Oczekuje na odpowiedź'}
    </span>
  );
}

function MessageDate({ value }: { value: string }) {
  return (
    <time dateTime={value} title="Data ostatniej wiadomości">
      {new Date(value).toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Warsaw',
      })}
    </time>
  );
}

export function Messages({ business = false }: { business?: boolean }) {
  const { api, act, user } = useApp();
  const { data: list, error, reload } = useData('/messages' + (business ? '?scope=company' : ''));
  const [selected, setSelected] = useState<Row | null>(null),
    [text, setText] = useState(''),
    [updatingStatus, setUpdatingStatus] = useState(false),
    [sending, setSending] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    setSelected(null);
    setText('');
  }, [user.id, user.role, user.company_id, business]);
  const current = selected
    ? list?.find(
        (m: Row) => m.vehicle_id === selected.vehicle_id && m.traveler_id === selected.traveler_id,
      ) || null
    : null;
  const conversation = useData(
    selected
      ? '/messages?vehicle=' +
          selected.vehicle_id +
          (business ? '&traveler=' + selected.traveler_id : '')
      : null,
  );
  return (
    <div className="panel messages-panel">
      <h2>Rozmowy w drodze</h2>
      <DataState data={list} error={error}>
        {list?.length ? (
          <div className="messages-layout">
            <div className="stack">
              {list.map((m: Row) => (
                <button
                  className={
                    'conversation-choice ' +
                    (current?.vehicle_id === m.vehicle_id && current?.traveler_id === m.traveler_id
                      ? 'active'
                      : '')
                  }
                  key={m.vehicle_id + ':' + m.traveler_id}
                  aria-pressed={
                    current?.vehicle_id === m.vehicle_id && current?.traveler_id === m.traveler_id
                  }
                  disabled={sending}
                  onClick={() => {
                    if (
                      selected?.vehicle_id !== m.vehicle_id ||
                      selected?.traveler_id !== m.traveler_id
                    )
                      setText('');
                    setSelected(m);
                  }}
                >
                  <strong>{business ? m.traveler_name : m.company_name}</strong>
                  <small className="conversation-vehicle">{m.vehicle_name}</small>
                  <span className="conversation-preview">{m.text}</span>
                  <MessageDate value={m.created_at} />
                  <ConversationStatus status={m.conversation_status} />
                </button>
              ))}
            </div>
            <div>
              {current ? (
                <>
                  <div className="conversation-title">
                    <div>
                      <h3>{business ? current.traveler_name : current.company_name}</h3>
                      <p className="small muted">{current.vehicle_name}</p>
                      <div className="conversation-meta">
                        <MessageDate value={current.created_at} />
                        <ConversationStatus status={current.conversation_status} />
                      </div>
                    </div>
                    {business && (
                      <button
                        type="button"
                        className="btn secondary conversation-resolve"
                        disabled={updatingStatus}
                        onClick={() => {
                          const resolved = current.conversation_status !== 'resolved';
                          setUpdatingStatus(true);
                          act(
                            async () => {
                              try {
                                await api('/messages/status', 'PATCH', {
                                  vehicleId: current.vehicle_id,
                                  travelerId: current.traveler_id,
                                  resolved,
                                });
                                reload();
                              } finally {
                                setUpdatingStatus(false);
                              }
                            },
                            resolved
                              ? 'Sprawa oznaczona jako rozwiązana.'
                              : 'Rozmowa ponownie otwarta.',
                          );
                        }}
                      >
                        {current.conversation_status === 'resolved' ? (
                          <MessageCircle size={16} aria-hidden="true" />
                        ) : (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        )}
                        {current.conversation_status === 'resolved'
                          ? 'Otwórz ponownie'
                          : 'Oznacz jako rozwiązane'}
                      </button>
                    )}
                  </div>
                  <DataState data={conversation.data} error={conversation.error}>
                    <div className="conversation-history">
                      {conversation.data?.map((m: Row) => (
                        <div
                          className={
                            'chat-bubble ' +
                            ((business ? m.author_id !== m.traveler_id : m.author_id === user.id)
                              ? 'own'
                              : '')
                          }
                          key={m.id}
                        >
                          <strong className="tiny">{m.author}</strong>
                          <p>{m.text}</p>
                          <small>
                            {new Date(m.created_at).toLocaleString('pl-PL', {
                              timeZone: 'Europe/Warsaw',
                            })}
                          </small>
                        </div>
                      ))}
                    </div>
                  </DataState>
                  <form
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (submitting.current) return;
                      submitting.current = true;
                      setSending(true);
                      act(async () => {
                        try {
                          await api('/messages', 'POST', {
                            vehicleId: current.vehicle_id,
                            ...(business ? { travelerId: current.traveler_id } : {}),
                            text,
                          });
                          setText('');
                          conversation.reload();
                          reload();
                        } finally {
                          submitting.current = false;
                          setSending(false);
                        }
                      }, 'Wiadomość zapisana.');
                    }}
                  >
                    <Field label="Twoja wiadomość">
                      <textarea
                        className="input"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        required
                        maxLength={3000}
                        disabled={sending}
                      />
                    </Field>
                    <button className="btn primary" disabled={sending}>
                      Wyślij wiadomość
                    </button>
                  </form>
                </>
              ) : (
                <Notice>Wybierz rozmowę z listy.</Notice>
              )}
            </div>
          </div>
        ) : (
          <Empty
            title="Tu zaczynają się dobre ustalenia."
            text="Napisz do wypożyczalni z karty wybranego pojazdu. Rozmowa pojawi się tutaj."
          />
        )}
      </DataState>
    </div>
  );
}
