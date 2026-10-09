'use client';
import { useState } from 'react';
import { Row, useApp, useData, DataState } from '../shared';
import { Require, Booking } from '../Account';
import { Shell } from './Shell';
import { Reservations } from './Reservations';
import { OperatorCompanies } from './Companies';
import { OperatorModeration } from './Moderation';
import { OperatorReports } from './Reports';
import { OperatorContent } from './Content';
import { OperatorSystem } from './System';
import { OperatorHistory } from './History';
import { OperatorDashboard } from './OperatorDashboard';

export function Operator({ tab, id }: { tab: string; id?: string }) {
  return (
    <Require role="admin">
      <OperatorBody tab={tab} id={id} />
    </Require>
  );
}
function OperatorBody({ tab, id }: { tab: string; id?: string }) {
  const { api, act } = useApp(),
    { data: d, error, reload } = useData('/admin/dashboard');
  const [editArticle, setEditArticle] = useState<string | null>(null);
  if (tab === 'rezerwacja' && id)
    return <Booking id={id} back="/operator/bookings" mode="admin" />;
  const mutation = async (path: string, body: Row, method = 'POST') =>
    act(async () => {
      const result = await api('/admin' + path, method, body);
      reload();
      return result;
    }, 'Zmiana zapisana w historii.');
  return (
    <Shell admin tab={tab}>
      <DataState data={d} error={error}>
        {d &&
          (tab === 'rezerwacje' ? (
            <Reservations rows={d.bookings} prefix="/operator/booking/" />
          ) : tab === 'firmy' ? (
            <OperatorCompanies d={d} mutation={mutation} />
          ) : tab === 'moderacja' ? (
            <OperatorModeration d={d} mutation={mutation} />
          ) : tab === 'zgloszenia' ? (
            <OperatorReports d={d} mutation={mutation} />
          ) : tab === 'tresci' ? (
            <OperatorContent
              d={d}
              mutation={mutation}
              editArticle={editArticle}
              setEditArticle={setEditArticle}
            />
          ) : tab === 'system' ? (
            <OperatorSystem d={d} mutation={mutation} />
          ) : tab === 'historia' ? (
            <OperatorHistory d={d} />
          ) : (
            <OperatorDashboard d={d} />
          ))}
      </DataState>
    </Shell>
  );
}
