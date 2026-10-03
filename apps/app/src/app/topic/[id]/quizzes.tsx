import { useLocalSearchParams } from 'expo-router';
import { QuizListScreen } from '@/components/QuizScreens';

export default function TopicQuizzes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <QuizListScreen scope={id} />;
}
