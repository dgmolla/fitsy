import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { FeedbackBoardPost } from '@fitsy/shared';
import { getFeedbackBoard, sendFeedback, voteFeedback } from '@/lib/apiClient';
import { FeedbackSheet } from '@/components/FeedbackSheet';
import { FitsyLoader } from '@/components';
import { EDITORIAL, FONTS } from '@/lib/brand';
import {
  trackFeedbackOpened,
  trackFeedbackSubmitted,
  trackFeedbackUpvoted,
} from '@/lib/analytics';

export default function FeedbackBoardScreen() {
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<FeedbackBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeVisible, setComposeVisible] = useState(false);

  const load = useCallback(async () => {
    const result = await getFeedbackBoard();
    setPosts(result?.data ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleVote = useCallback(async (post: FeedbackBoardPost) => {
    const nextHasVoted = !post.hasVoted;
    // Optimistic update — reverted below if the request fails.
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, hasVoted: nextHasVoted, voteCount: p.voteCount + (nextHasVoted ? 1 : -1) }
          : p,
      ),
    );
    const result = await voteFeedback(post.id);
    if (!result) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
      return;
    }
    trackFeedbackUpvoted({ feedback_id: post.id, action: nextHasVoted ? 'upvote' : 'unvote' });
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, voteCount: result.voteCount, hasVoted: result.hasVoted } : p)),
    );
  }, []);

  const openCompose = useCallback(() => {
    trackFeedbackOpened();
    setComposeVisible(true);
  }, []);

  const handleSubmit = useCallback(async (message: string): Promise<boolean> => {
    const result = await sendFeedback(message);
    trackFeedbackSubmitted({ message_length: message.length, success: result.ok });
    if (result.ok) {
      await load();
      return true;
    }
    Alert.alert('Could not send', result.error);
    return false;
  }, [load]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.nav}>
          <Pressable onPress={() => router.back()} style={s.navBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={18} color={EDITORIAL.text} />
          </Pressable>
          <Text style={s.navTitle}>Feedback board</Text>
          <Pressable onPress={openCompose} style={s.navBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add feedback">
            <Ionicons name="add" size={22} color={EDITORIAL.greenAccent} />
          </Pressable>
        </View>

        {loading ? (
          <View style={s.centered}>
            <FitsyLoader size="md" />
          </View>
        ) : posts.length === 0 ? (
          <View style={s.centered}>
            <Text style={s.emptyText}>
              No requests yet.{'\n'}Be the first to share an idea.
            </Text>
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.listContent}
            ListHeaderComponent={
              <Text style={s.subhead}>What should we build next? Upvote what matters to you.</Text>
            }
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={s.cardBody}>
                  <Text style={s.message}>{item.message}</Text>
                  <Text style={s.author}>— {item.displayName}</Text>
                </View>
                <Pressable
                  style={[s.voteBtn, item.hasVoted && s.voteBtnActive]}
                  onPress={() => handleVote(item)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={item.hasVoted ? 'Remove upvote' : 'Upvote'}
                >
                  <Ionicons
                    name="chevron-up"
                    size={18}
                    color={item.hasVoted ? '#FDFBF7' : EDITORIAL.greenAccent}
                  />
                  <Text style={[s.voteCount, item.hasVoted && s.voteCountActive]}>{item.voteCount}</Text>
                </Pressable>
              </View>
            )}
          />
        )}
      </View>

      <FeedbackSheet
        visible={composeVisible}
        onClose={() => setComposeVisible(false)}
        onSubmit={handleSubmit}
      />
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITORIAL.cream },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  navBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 18,
    color: EDITORIAL.text,
    letterSpacing: -0.3,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    lineHeight: 22,
  },
  subhead: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    color: EDITORIAL.textSoft,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    padding: 14,
    marginBottom: 10,
  },
  cardBody: { flex: 1, gap: 4 },
  message: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 14,
    fontWeight: '600',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  author: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 11,
    color: EDITORIAL.textSoft,
  },
  // Vertical arrow-over-count control — the familiar Reddit/HN upvote shape,
  // chosen over the earlier pill+icon because a single up-pointing arrow that
  // fills solid on tap reads unambiguously as "vote" at a glance.
  voteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    backgroundColor: EDITORIAL.creamCard,
    width: 48,
    paddingVertical: 8,
  },
  voteBtnActive: {
    backgroundColor: EDITORIAL.greenAccent,
    borderColor: EDITORIAL.greenAccent,
  },
  voteCount: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 13,
    fontWeight: '700',
    color: EDITORIAL.greenAccent,
  },
  voteCountActive: {
    color: '#FDFBF7',
  },
});
