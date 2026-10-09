import { Suspense } from 'react';
import VanlyApp from '../components/VanlyApp';

export default function NotFound() {
  return (
    <Suspense>
      <VanlyApp publicPage missingPage />
    </Suspense>
  );
}
