import type { FeedbackBoardPost } from '@fitsy/shared';
import { Alert, act, fireEvent, renderJourney, routes, waitFor } from './OnboardingNavigationHarness';
import FeedbackBoard from '../app/feedback-board';
import * as api from '../lib/apiClient';

// The compose sheet pulls the shared package's env module, which jest cannot load, and is not under test here.
jest.mock('./FeedbackSheet', () => ({ FeedbackSheet: () => null }));

const boardRoutes = { ...routes, 'feedback-board': FeedbackBoard };
const open = () => renderJourney('/feedback-board', boardRoutes);

const post = (id: string, displayName: string, isOwn = false): FeedbackBoardPost =>
  ({ id, displayName, message: `idea ${id}`, voteCount: 1, createdAt: '2026-11-17T00:00:00.000Z', hasVoted: false, isOwn });

type AlertButton = { text?: string; onPress?: () => void };
let alertSpy: jest.SpyInstance;
const pressAlertButton = (label: string) => {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
  const button = buttons.find(b => b.text === label);
  if (!button?.onPress) throw new Error(`No "${label}" button in the last alert`);
  act(() => { button.onPress!(); });
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(api, 'getFeedbackBoard');
  jest.spyOn(api, 'reportFeedback');
  jest.spyOn(api, 'blockFeedbackAuthor');
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (api.getFeedbackBoard as jest.Mock).mockResolvedValue({
    data: [post('a', 'Ann'), post('b', 'Bob'), post('mine', 'Me', true)],
    meta: { hasMore: false },
  });
});

it('offers report and block only on other people’s posts', async () => {
  const screen = open();
  await screen.findByText('idea a');
  expect(screen.getByTestId('feedback-post-menu-a')).toBeTruthy();
  expect(screen.getByTestId('feedback-post-menu-b')).toBeTruthy();
  expect(screen.queryByTestId('feedback-post-menu-mine')).toBeNull();
});

it('reports a post, hides it for the reporter and says so', async () => {
  (api.reportFeedback as jest.Mock).mockResolvedValue(true);
  const screen = open();
  await screen.findByText('idea a');
  await act(async () => { fireEvent.press(screen.getByTestId('feedback-post-menu-a')); });
  pressAlertButton('Report post');
  await waitFor(() => expect(api.reportFeedback).toHaveBeenCalledWith('a'));
  await waitFor(() => expect(screen.queryByText('idea a')).toBeNull());
  expect(screen.getByText('idea b')).toBeTruthy();
  expect(alertSpy.mock.calls.at(-1)?.[0]).toBe('Thanks for letting us know');
});

it('keeps the post and says so when the report fails', async () => {
  (api.reportFeedback as jest.Mock).mockResolvedValue(false);
  const screen = open();
  await screen.findByText('idea a');
  await act(async () => { fireEvent.press(screen.getByTestId('feedback-post-menu-a')); });
  pressAlertButton('Report post');
  await waitFor(() => expect(alertSpy.mock.calls.at(-1)?.[0]).toBe('Could not report'));
  expect(screen.getByText('idea a')).toBeTruthy();
});

it('blocks an author only after confirmation and then reloads the board', async () => {
  (api.blockFeedbackAuthor as jest.Mock).mockResolvedValue(true);
  const screen = open();
  await screen.findByText('idea a');
  await act(async () => { fireEvent.press(screen.getByTestId('feedback-post-menu-a')); });
  pressAlertButton('Block Ann');
  expect(api.blockFeedbackAuthor).not.toHaveBeenCalled();
  (api.getFeedbackBoard as jest.Mock).mockResolvedValue({ data: [post('b', 'Bob'), post('mine', 'Me', true)], meta: { hasMore: false } });
  pressAlertButton('Block');
  await waitFor(() => expect(api.blockFeedbackAuthor).toHaveBeenCalledWith('a'));
  await waitFor(() => expect(screen.queryByText('idea a')).toBeNull());
  expect(screen.getByText('idea b')).toBeTruthy();
});
