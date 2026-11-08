import { router } from 'expo-router';

/** Back, or Home when a screen was opened directly (a deep link or notification) with nothing behind it. */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
