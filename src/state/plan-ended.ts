/**
 * "Sarraf Plus has ended" is asked once per app open (Owner, Nov 12): closing
 * it archives nothing, and it comes back the next time the app starts.
 */
let dismissed = false;
export const dismissPlanChoice = () => {
  dismissed = true;
};
export const planChoiceDismissed = () => dismissed;
