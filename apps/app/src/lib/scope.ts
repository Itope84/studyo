import { courseIdOf, isCourseScope } from '@studyo/api';
import type { Href } from 'expo-router';

/** Where a topic id or a course scope id (`course--<id>`) lives in the app. */
export const scopeHref = (scope: string): Href =>
  isCourseScope(scope) ? `/course/${courseIdOf(scope)}` : `/topic/${scope}`;
