// Legacy simulator is opt-in; new installations reserve without collecting rent.
export function legacyTravelerPayments() {
  return (
    process.env.TRAVELER_PAYMENT_MODE === 'local_test' && process.env.LOCAL_PAYMENTS === 'true'
  );
}
