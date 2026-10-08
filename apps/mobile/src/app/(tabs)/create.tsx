import { Redirect } from 'expo-router';
/** Never shown: the tab press is intercepted and opens the composer modal. */
export default function CreateTab() {
  return <Redirect href="/post/create" />;
}
