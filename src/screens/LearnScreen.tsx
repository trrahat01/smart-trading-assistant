import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LESSONS } from '../data/learning';
import { useStore } from '../store/useStore';

export const LearnScreen = () => {
  const { completedLessons, quizAttempts, markLessonComplete, saveQuizAttempt } = useStore(
    (state) => state
  );
  const [selectedLessonId, setSelectedLessonId] = useState(LESSONS[0].id);
  const [activeQuizLessonId, setActiveQuizLessonId] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);

  const selectedLesson =
    LESSONS.find((lesson) => lesson.id === selectedLessonId) ?? LESSONS[0];
  const activeQuizLesson = LESSONS.find((lesson) => lesson.id === activeQuizLessonId);

  const completionRate = (completedLessons.length / LESSONS.length) * 100;
  const avgQuizScore = useMemo(() => {
    if (!quizAttempts.length) {
      return 0;
    }
    const percentSum = quizAttempts.reduce(
      (sum, attempt) => sum + (attempt.score / attempt.total) * 100,
      0
    );
    return percentSum / quizAttempts.length;
  }, [quizAttempts]);

  const startQuiz = (lessonId: string) => {
    setActiveQuizLessonId(lessonId);
    setQuestionIndex(0);
    setCorrectAnswers(0);
  };

  const answerQuestion = (answerIndex: number) => {
    if (!activeQuizLesson) {
      return;
    }
    const question = activeQuizLesson.quiz[questionIndex];
    const nextCorrect = answerIndex === question.answerIndex ? correctAnswers + 1 : correctAnswers;

    Alert.alert('Answer', question.explanation);

    const isLast = questionIndex >= activeQuizLesson.quiz.length - 1;
    if (isLast) {
      markLessonComplete(activeQuizLesson.id);
      saveQuizAttempt({
        lessonId: activeQuizLesson.id,
        score: nextCorrect,
        total: activeQuizLesson.quiz.length,
      });
      setActiveQuizLessonId(null);
      setQuestionIndex(0);
      setCorrectAnswers(0);
      Alert.alert(
        'Quiz complete',
        `You scored ${nextCorrect}/${activeQuizLesson.quiz.length}.`
      );
      return;
    }

    setCorrectAnswers(nextCorrect);
    setQuestionIndex((prev) => prev + 1);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Trading Learning Path</Text>
        <Text style={styles.progressValue}>{completionRate.toFixed(0)}% completed</Text>
        <Text style={styles.progressMeta}>
          Lessons done: {completedLessons.length}/{LESSONS.length}
        </Text>
        <Text style={styles.progressMeta}>
          Avg quiz score: {avgQuizScore.toFixed(1)}%
        </Text>
      </View>

      {activeQuizLesson ? (
        <View style={styles.quizCard}>
          <Text style={styles.quizTitle}>{activeQuizLesson.title} Quiz</Text>
          <Text style={styles.quizMeta}>
            Question {questionIndex + 1}/{activeQuizLesson.quiz.length}
          </Text>
          <Text style={styles.quizQuestion}>{activeQuizLesson.quiz[questionIndex].question}</Text>

          {activeQuizLesson.quiz[questionIndex].options.map((option, index) => (
            <Pressable
              key={`${activeQuizLesson.quiz[questionIndex].id}-${option}`}
              style={styles.quizOption}
              onPress={() => answerQuestion(index)}
            >
              <Text style={styles.quizOptionText}>{option}</Text>
            </Pressable>
          ))}

          <Pressable style={styles.cancelQuizButton} onPress={() => setActiveQuizLessonId(null)}>
            <Text style={styles.cancelQuizText}>Exit Quiz</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.lessonListCard}>
            <Text style={styles.sectionTitle}>Lessons</Text>
            {LESSONS.map((lesson) => {
              const selected = lesson.id === selectedLesson.id;
              const done = completedLessons.includes(lesson.id);
              return (
                <Pressable
                  key={lesson.id}
                  onPress={() => setSelectedLessonId(lesson.id)}
                  style={[
                    styles.lessonItem,
                    selected ? styles.lessonItemSelected : styles.lessonItemDefault,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lessonTitle}>{lesson.title}</Text>
                    <Text style={styles.lessonMeta}>
                      {lesson.level} · {lesson.durationMinutes} min
                    </Text>
                  </View>
                  <Text style={[styles.lessonBadge, done ? styles.done : styles.todo]}>
                    {done ? 'Done' : 'Todo'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>{selectedLesson.title}</Text>
            <Text style={styles.detailText}>{selectedLesson.summary}</Text>

            {selectedLesson.keyPoints.map((point) => (
              <Text key={`${selectedLesson.id}-${point}`} style={styles.keyPoint}>
                • {point}
              </Text>
            ))}

            <Pressable style={styles.startQuizButton} onPress={() => startQuiz(selectedLesson.id)}>
              <Text style={styles.startQuizText}>
                Start Quiz ({selectedLesson.quiz.length} questions)
              </Text>
            </Pressable>
          </View>

          <View style={styles.historyCard}>
            <Text style={styles.sectionTitle}>Recent Quiz Attempts</Text>
            {quizAttempts.length === 0 ? (
              <Text style={styles.detailText}>No attempts yet.</Text>
            ) : (
              quizAttempts.slice(0, 8).map((attempt) => {
                const lesson = LESSONS.find((item) => item.id === attempt.lessonId);
                const percent = (attempt.score / attempt.total) * 100;
                return (
                  <View key={attempt.id} style={styles.historyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyTitle}>{lesson?.title ?? attempt.lessonId}</Text>
                      <Text style={styles.historyMeta}>
                        {new Date(attempt.attemptedAt).toLocaleString()}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.historyScore,
                        percent >= 70 ? styles.done : styles.todo,
                      ]}
                    >
                      {attempt.score}/{attempt.total}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1020',
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 30,
  },
  progressCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    gap: 4,
  },
  progressTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  progressValue: {
    color: '#38BDF8',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 3,
  },
  progressMeta: {
    color: '#94A3B8',
    fontSize: 13,
  },
  lessonListCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 3,
  },
  lessonItem: {
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lessonItemSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#082F49',
  },
  lessonItemDefault: {
    borderColor: '#334155',
    backgroundColor: '#1E293B',
  },
  lessonTitle: {
    color: '#E2E8F0',
    fontWeight: '700',
  },
  lessonMeta: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  lessonBadge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  done: {
    color: '#22C55E',
  },
  todo: {
    color: '#F59E0B',
  },
  detailCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  detailText: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 20,
  },
  keyPoint: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 19,
  },
  startQuizButton: {
    marginTop: 8,
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  startQuizText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  historyCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: '#1F2937',
    borderBottomWidth: 1,
    paddingBottom: 9,
  },
  historyTitle: {
    color: '#E2E8F0',
    fontWeight: '600',
  },
  historyMeta: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  historyScore: {
    fontWeight: '700',
  },
  quizCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  quizTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
  },
  quizMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  quizQuestion: {
    color: '#E2E8F0',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 2,
  },
  quizOption: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  quizOptionText: {
    color: '#E2E8F0',
    fontSize: 13,
  },
  cancelQuizButton: {
    marginTop: 8,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelQuizText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
});
