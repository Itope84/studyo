import { useLocalSearchParams } from 'expo-router';
import { QuizListScreen } from '@/components/QuizScreens';

export default function CourseQuizzes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <QuizListScreen scope={`course--${id}`} />;
}
