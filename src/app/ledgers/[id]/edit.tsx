import { useLocalSearchParams } from 'expo-router';

import { LedgerForm, useLedger } from '@/components/forms/LedgerForm';

export default function EditLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger(id);
  return ledger ? <LedgerForm key={ledger.id} ledger={ledger} /> : null;
}
