export async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function enqueueEvent(db, recipientId, eventKey, payload, now, resourceKey = null) {
  const record = await db.query(
    `INSERT INTO notification_events(recipient_user_id,event_key,created_at,resource_key)
    VALUES($1,$2,$3,$4) ON CONFLICT(recipient_user_id,event_key) DO NOTHING RETURNING event_key`,
    [recipientId, eventKey, now, resourceKey],
  );
  if (!record.rowCount) return null;
  const job = await db.query(
    `INSERT INTO jobs(kind,payload,recipient_user_id,event_key,created_at)
    VALUES('mail',$1,$2,$3,$4) ON CONFLICT(recipient_user_id,event_key)
    WHERE kind='mail' AND event_key IS NOT NULL DO NOTHING RETURNING id`,
    [JSON.stringify({ ...payload, userId: recipientId }), recipientId, eventKey, now],
  );
  const id = job.rows[0]?.id || null;
  await db.query(
    'UPDATE notification_events SET job_id=$3 WHERE recipient_user_id=$1 AND event_key=$2',
    [recipientId, eventKey, id],
  );
  return id;
}
export function genericNotice(subject, intro, details, nextStep, actionUrl, extra = {}) {
  const { category = 'TWOJA REZERWACJA', ...options } = extra;
  return {
    subject,
    body: [intro, details, nextStep, actionUrl].filter(Boolean).join('\n\n'),
    template: '00-bazowy-transakcyjny',
    variables: {
      email_subject: subject,
      email_preheader: intro,
      email_heading: subject,
      message_category: category,
      intro_text: intro,
      details_text: details,
      next_step_text: nextStep,
      cta_label: 'Otwórz w VANLY',
      action_url: actionUrl,
    },
    senderKind: 'portal',
    ...options,
  };
}
