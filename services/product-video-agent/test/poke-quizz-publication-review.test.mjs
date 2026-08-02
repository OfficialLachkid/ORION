import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokeQuizzDeleteTask,
  buildPokeQuizzFeedbackRegenerationTask,
  buildPokeQuizzPublicationReviewEvent,
  buildPokeQuizzPublicationReviewPayload,
  buildPokeQuizzPublicationReviewTask,
  deriveFeedbackRevisionSeed,
} from '../src/poke-quizz-publication-review.mjs';

const publication = {
  id: 'publication-123',
  video_id: 'video-123',
  preview_url: 'https://youtube.com/shorts/preview-123',
  metadata: {
    type_pair: ['water', 'flying'],
    seed: 'water-flying-random-20260731t220000z',
    render_path: '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Previews/water-flying.mp4',
  },
};

const video = {
  id: 'video-123',
  render: {
    output_path: publication.metadata.render_path,
  },
};

const channelProfile = {
  name: 'Poke Quizz',
  youtube: {
    channel_id: 'UCvMqBsEPDvjgNRMymQyefFg',
  },
};

test('buildPokeQuizzPublicationReviewTask creates an approval-gated publish task', () => {
  const task = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    channelProfile,
    reviewThreadId: '1532709429902839810',
    planPath: 'data/runtime/product-video-agent/poke-quizz/example-plan.json',
    renderPath: publication.metadata.render_path,
    catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-serebii.json',
    generationDurationMinutes: 3,
    submittedAt: '2026-07-31T20:45:00.000Z',
  });

  assert.match(task.task_id, /^TASK-ORION-PQ-PUBLISH-20260731204500-[A-F0-9]{12}$/u);
  assert.equal(task.runtime_action, 'poke_quizz_publish_preview');
  assert.equal(task.automation_type, 'poke_quizz_publication_review');
  assert.equal(task.poke_quizz_publication_review.previewUrl, publication.preview_url);
  assert.equal(task.poke_quizz_publication_review.reviewThreadId, '1532709429902839810');
  assert.equal(task.poke_quizz_publication_review.channelName, 'Poke Quizz');
  assert.equal(task.poke_quizz_publication_review.channelUrl, 'https://www.youtube.com/channel/UCvMqBsEPDvjgNRMymQyefFg');
  assert.equal(task.poke_quizz_publication_review.generationDurationLabel, '3 min');
});

test('buildPokeQuizzPublicationReviewEvent adds preview-review metadata and labels', () => {
  const task = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    channelProfile,
    reviewThreadId: '1532709429902839810',
    planPath: 'data/runtime/product-video-agent/poke-quizz/example-plan.json',
    renderPath: publication.metadata.render_path,
    catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-serebii.json',
    generationDurationMinutes: 2,
    submittedAt: '2026-07-31T20:45:00.000Z',
  });

  const event = buildPokeQuizzPublicationReviewEvent(task);
  assert.equal(event.channelKey, 'pokeQuizzReview');
  assert.equal(event.metadata.publicationReview, true);
  assert.equal(event.metadata.approveLabel, 'Publish');
  assert.equal(event.metadata.rejectLabel, 'Give Feedback');
  assert.equal(event.metadata.deleteLabel, 'Delete');
  assert.equal(event.metadata.previewUrl, publication.preview_url);
  assert.equal(event.metadata.genreLabel, 'Type Combination');
  assert.equal(event.metadata.channelName, 'Poke Quizz');
  assert.equal(event.metadata.generationDurationLabel, '2 min');
});

test('buildPokeQuizzPublicationReviewPayload renders Publish, Give Feedback, and Delete buttons', () => {
  const task = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    channelProfile,
    reviewThreadId: '1532709429902839810',
    planPath: 'data/runtime/product-video-agent/poke-quizz/example-plan.json',
    renderPath: publication.metadata.render_path,
    catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-serebii.json',
    submittedAt: '2026-07-31T20:45:00.000Z',
  });

  const { payload } = buildPokeQuizzPublicationReviewPayload(task);
  assert.equal(payload.components[0].components[0].label, 'Publish');
  assert.equal(payload.components[0].components[1].label, 'Give Feedback');
  assert.equal(payload.components[0].components[2].label, 'Delete');
});

test('feedback regeneration task carries the operator notes forward', () => {
  const reviewTask = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    channelProfile,
    reviewThreadId: '1532709429902839810',
    planPath: 'data/runtime/product-video-agent/poke-quizz/example-plan.json',
    renderPath: publication.metadata.render_path,
    catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-serebii.json',
    submittedAt: '2026-07-31T20:45:00.000Z',
  });
  const regenTask = buildPokeQuizzFeedbackRegenerationTask({
    reviewTask,
    feedback: 'Use a cleaner opener and keep the same type pair.',
    actor: 'Valen',
    actorId: 'user-1',
    submittedAt: '2026-07-31T20:46:00.000Z',
  });

  assert.match(regenTask.task_id, /^TASK-ORION-PQ-REGENERATE-20260731204600-[A-F0-9]{12}$/u);
  assert.equal(regenTask.runtime_action, 'poke_quizz_feedback_regenerate');
  assert.equal(regenTask.poke_quizz_feedback.feedback, 'Use a cleaner opener and keep the same type pair.');
  assert.equal(regenTask.poke_quizz_feedback.reviewThreadId, '1532709429902839810');
});

test('delete task carries the current review target without feedback regeneration', () => {
  const reviewTask = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    channelProfile,
    reviewThreadId: '1532709429902839810',
    planPath: 'data/runtime/product-video-agent/poke-quizz/example-plan.json',
    renderPath: publication.metadata.render_path,
    catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-serebii.json',
    submittedAt: '2026-07-31T20:45:00.000Z',
  });
  const deleteTask = buildPokeQuizzDeleteTask({
    reviewTask,
    actor: 'Valen',
    actorId: 'user-1',
    submittedAt: '2026-07-31T20:46:00.000Z',
  });

  assert.match(deleteTask.task_id, /^TASK-ORION-PQ-DELETE-20260731204600-[A-F0-9]{12}$/u);
  assert.equal(deleteTask.runtime_action, 'poke_quizz_delete_preview');
  assert.equal(deleteTask.poke_quizz_delete.reviewThreadId, '1532709429902839810');
  assert.equal(deleteTask.poke_quizz_delete.videoId, 'video-123');
});

test('deriveFeedbackRevisionSeed produces a distinct auditable revision seed', () => {
  const reviewTask = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    channelProfile,
    reviewThreadId: '1532709429902839810',
    planPath: 'data/runtime/product-video-agent/poke-quizz/example-plan.json',
    renderPath: publication.metadata.render_path,
    catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-serebii.json',
    submittedAt: '2026-07-31T20:45:00.000Z',
  });
  const seed = deriveFeedbackRevisionSeed(
    reviewTask,
    'Keep the same pair but vary the preview composition.',
    '2026-07-31T20:46:00.000Z',
  );

  assert.match(seed, /^water-flying-random-20260731t220000z-feedback-20260731204600-[a-f0-9]{8}$/u);
});
