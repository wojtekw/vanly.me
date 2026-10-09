'use client';
import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useApp, Notice, Empty } from '../../components/shared';

export function Require({ children, role }: { children: React.ReactNode; role?: string }) {
  const { user } = useApp();
  if (!user)
    return (
      <div className="container section">
        <Empty
          title="Twoja podróż zaczyna się od konta."
          text="Zaloguj się, aby zobaczyć zapisane dane i rezerwacje."
        >
          <Link className="btn primary" href="/logowanie">
            Zaloguj się <ArrowRight size={17} />
          </Link>
        </Empty>
      </div>
    );
  if (role && user.role !== role)
    return (
      <div className="container section">
        <Notice error>To konto nie ma dostępu do tego panelu.</Notice>
        <Link className="btn secondary" href="/konto">
          Przejdź do swojego konta
        </Link>
      </div>
    );
  return <>{children}</>;
}
