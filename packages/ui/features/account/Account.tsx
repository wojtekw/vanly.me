'use client';
import Link from 'next/link';
import { ArrowRight, CalendarDays, MessageCircle, UserRound, Mail, LifeBuoy, FileText, Heart } from 'lucide-react';
import { useApp, Heading } from '../../components/shared';
import { Require } from '../auth/Require';
import { Trips } from './Trips';
import { Profile } from './Profile';
import { LocalMail } from './LocalMail';
import { Reports } from './Reports';
import { Messages } from '../messages/Messages';

export function Account({ tab }: { tab: string }) {
  return (
    <Require>
      <AccountBody tab={tab} />
    </Require>
  );
}

function AccountBody({ tab }: { tab: string }) {
  const { user } = useApp();
  return (
    <div className="container">
      <Heading
        eyebrow={'Dobrze Cię widzieć, ' + user.name}
        title={
          user.role === 'owner'
            ? 'Twoje konto i wypożyczalnia.'
            : user.role === 'admin'
              ? 'Twoje konto operatora.'
              : 'Wszystko na Twój wyjazd.'
        }
      />
      <div className="account-type-summary">
        <strong>
          {user.role === 'owner'
            ? 'Konto wypożyczalni'
            : user.role === 'admin'
              ? 'Konto operatora'
              : 'Konto podróżującego'}
        </strong>
        {user.role === 'traveler' && (
          <Link className="text-link" href="/dla-firm/rejestracja">
            Dodaj wypożyczalnię do tego konta <ArrowRight size={17} />
          </Link>
        )}
      </div>
      <div className="account-layout">
        <nav
          className="side-nav"
          aria-label={
            user.role === 'owner'
              ? 'Konto wypożyczalni'
              : user.role === 'admin'
                ? 'Konto operatora'
                : 'Konto podróżującego'
          }
        >
          {[
            ['podroze', 'Moje podróże', CalendarDays],
            ['wiadomosci', 'Wiadomości', MessageCircle],
            ['dokumenty', 'Dokumenty', FileText],
            ['profil', 'Profil i kierowcy', UserRound],
            ['skrzynka', 'Lokalna skrzynka', Mail],
            ['pomoc', 'Moje zgłoszenia', LifeBuoy],
          ].map(([id, label, Icon]: any) => (
            <Link className={tab === id ? 'active' : ''} href={'/konto/' + id} key={id}>
              <Icon size={19} />
              {label}
            </Link>
          ))}
          <Link href="/ulubione">
            <Heart size={19} />
            Ulubione pojazdy
          </Link>
          {user.role === 'owner' && (
            <Link href="/company">
              Panel firmy <ArrowRight size={17} />
            </Link>
          )}
          {user.role === 'admin' && (
            <Link href="/operator">
              Panel operatora <ArrowRight size={17} />
            </Link>
          )}
        </nav>
        <div>
          {tab === 'profil' ? (
            <Profile />
          ) : tab === 'wiadomosci' ? (
            <Messages />
          ) : tab === 'skrzynka' ? (
            <LocalMail />
          ) : tab === 'pomoc' ? (
            <Reports />
          ) : (
            <Trips documents={tab === 'dokumenty'} />
          )}
        </div>
      </div>
    </div>
  );
}
