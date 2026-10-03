import type { components, paths } from './schema.gen.ts';

export type { components, paths };

type S = components['schemas'];

export type ApiError = S['Error'];
export type Health = S['Health'];
export type CliId = S['CliId'];
export type CliInfo = S['CliInfo'];
export type ServerInfo = S['ServerInfo'];
export type Settings = S['Settings'];
export type TopicStatus = S['TopicStatus'];
export type Origin = S['Origin'];
export type ResourceType = S['ResourceType'];
export type Resource = S['Resource'];
export type Learning = S['Learning'];
export type Topic = S['Topic'];
export type TopicSummary = S['TopicSummary'];
export type ContinueItem = S['ContinueItem'];
export type TopicList = S['TopicList'];
export type TopicDetail = S['TopicDetail'];
export type TopicWithJob = S['TopicWithJob'];
export type CreateTopic = S['CreateTopic'];
export type UpdateTopic = S['UpdateTopic'];
export type Rendered = S['Rendered'];
export type Pdf = S['Pdf'];
export type ProgressItem = S['ProgressItem'];
export type Progress = S['Progress'];
export type ProgressUpdate = S['ProgressUpdate'];
export type Bookmark = S['Bookmark'];
export type CreateBookmark = S['CreateBookmark'];
export type JobKind = S['JobKind'];
export type JobStatus = S['JobStatus'];
export type Job = S['Job'];
export type JobList = S['JobList'];
export type LogLine = S['LogLine'];
export type JobDetail = S['JobDetail'];
export type CreateJob = S['CreateJob'];
export type QuestionSet = S['QuestionSet'];
export type Question = S['Question'];
export type AnswerSet = S['AnswerSet'];
export type ChatMessage = S['ChatMessage'];
export type ChatHistory = S['ChatHistory'];
export type SendChat = S['SendChat'];
export type ChatTurn = S['ChatTurn'];
export type ChapterRef = S['ChapterRef'];
export type CourseChapter = S['CourseChapter'];
export type SourceRange = S['SourceRange'];
export type CourseStatus = S['CourseStatus'];
export type Course = S['Course'];
export type ChapterState = S['ChapterState'];
export type ChapterView = S['ChapterView'];
export type CourseSummary = S['CourseSummary'];
export type CourseList = S['CourseList'];
export type CourseDetail = S['CourseDetail'];
export type CreateCourse = S['CreateCourse'];
export type CourseWithJob = S['CourseWithJob'];
export type UpdateCourse = S['UpdateCourse'];
export type BuildChapters = S['BuildChapters'];
export type QuizQuestion = S['QuizQuestion'];
export type QuestionResult = S['QuestionResult'];
export type QuizAttempt = S['QuizAttempt'];
export type Quiz = S['Quiz'];
export type QuizList = S['QuizList'];
export type CreateQuiz = S['CreateQuiz'];
export type QuizWithJob = S['QuizWithJob'];
export type SubmitAttempt = S['SubmitAttempt'];
export type AssignmentBrief = S['AssignmentBrief'];
export type CriterionReview = S['CriterionReview'];
export type Review = S['Review'];
export type Submission = S['Submission'];
export type Assignment = S['Assignment'];
export type AssignmentList = S['AssignmentList'];
export type CreateAssignment = S['CreateAssignment'];
export type AssignmentWithJob = S['AssignmentWithJob'];
export type CreateSubmission = S['CreateSubmission'];
export type InboxItem = S['InboxItem'];
export type InboxList = S['InboxList'];
export type AssignInbox = S['AssignInbox'];
export type KnowsEntry = S['KnowsEntry'];
export type Profile = S['Profile'];
export type PushSubscription = S['PushSubscription'];
export type EventType = S['EventType'];

export type JobUpdatedData = S['JobUpdatedData'];
export type JobLogData = S['JobLogData'];
export type ChatDeltaData = S['ChatDeltaData'];
export type ChatMessageData = S['ChatMessageData'];
export type TopicEventData = S['TopicEventData'];

/** A decoded SSE event, narrowed by type. */
export type StudyoEvent =
  | { id: number; type: 'job.updated'; at: string; data: JobUpdatedData }
  | { id: number; type: 'job.log'; at: string; data: JobLogData }
  | { id: number; type: 'chat.delta'; at: string; data: ChatDeltaData }
  | { id: number; type: 'chat.message'; at: string; data: ChatMessageData }
  | { id: number; type: 'topic.updated' | 'topic.removed'; at: string; data: TopicEventData }
  | { id: number; type: 'inbox.updated' | 'resync'; at: string; data: Record<string, never> };

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['queued', 'running', 'needs_input'];
export const DOC_TYPES: readonly ResourceType[] = ['pack', 'condensed'];
export const MEDIA_TYPES: readonly ResourceType[] = ['audio', 'video'];

/** Course-level jobs, chat and quizzes use a scope id in place of a topic id. */
export const COURSE_SCOPE_PREFIX = 'course--';
export const courseScope = (courseId: string) => `${COURSE_SCOPE_PREFIX}${courseId}`;
export const isCourseScope = (id: string) => id.startsWith(COURSE_SCOPE_PREFIX);
export const courseIdOf = (scope: string) => scope.slice(COURSE_SCOPE_PREFIX.length);
