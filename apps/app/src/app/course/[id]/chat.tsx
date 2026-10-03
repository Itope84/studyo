import { useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '@/components/ChatScreen';

/** Ask across the whole course. The scope id stands in for a topic id. */
export default function CourseChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen id={`course--${id}`} />;
}
