import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';

/**
 * GitHub sign-in comes back to sarraf://auth-callback. The sign-in screen reads
 * that link itself; if the router opens this page too, it steps straight back
 * so the sign-in screen underneath keeps its place.
 */
export default function AuthCallback() {
  const canGoBack = router.canGoBack();
  useEffect(() => {
    if (canGoBack) router.back();
  }, [canGoBack]);
  return canGoBack ? null : <Redirect href="/" />;
}
