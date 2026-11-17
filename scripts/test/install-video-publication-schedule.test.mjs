import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECONCILE_DELAY_MINUTES,
  DEFAULT_RECONCILE_DELAYS_MINUTES,
  DEFAULT_STORY_CONTINUATION_DELAY_MINUTES,
  PLIST_LABEL,
  RECONCILE_PLIST_LABEL,
  STORY_CONTINUATION_PLIST_LABEL,
  buildReconcileScheduleEntries,
  buildPlistContent,
  collectActivePublicationScheduleEntries,
  collectActiveStoryContinuationScheduleEntries,
  offsetScheduleEntries,
} from '../install-video-publication-schedule.mjs';

const publicationScheduleEntries = [
  { hour: 8, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 14, minute: 0 },
];

const plistOptions = {
  nodePath: '/opt/homebrew/bin/node',
  scriptPath: '/Users/Agent/Workspace/ORION/services/product-video-agent/scripts/run-video-publication-scheduler.mjs',
  workingDirectory: '/Users/Agent/Workspace/ORION',
  stdoutPath: '/Users/Agent/Library/Logs/vbj/video-publication.stdout.log',
  stderrPath: '/Users/Agent/Library/Logs/vbj/video-publication.stderr.log',
};

test('publication scheduler plist keeps the full runs at 08:00, 12:00, and 14:00', () => {
  const plist = buildPlistContent({
    ...plistOptions,
    label: PLIST_LABEL,
    scheduleEntries: publicationScheduleEntries,
  });

  assert.match(plist, new RegExp(`<string>${PLIST_LABEL}</string>`));
  assert.equal((plist.match(/<integer>0<\/integer>/g) || []).length, 3);
  assert.doesNotMatch(plist, /--reconcile-only/);
  for (const { hour } of publicationScheduleEntries) {
    assert.match(plist, new RegExp(`<integer>${hour}</integer>`));
  }
});

test('publication reconciliation plist runs lightweight follow-ups at 08:05, 12:05, and 14:05', () => {
  const reconciliationEntries = offsetScheduleEntries(
    publicationScheduleEntries,
    DEFAULT_RECONCILE_DELAY_MINUTES,
  );
  const plist = buildPlistContent({
    ...plistOptions,
    label: RECONCILE_PLIST_LABEL,
    scheduleEntries: reconciliationEntries,
    reconcileOnly: true,
  });

  assert.match(plist, new RegExp(`<string>${RECONCILE_PLIST_LABEL}</string>`));
  assert.match(plist, /<string>--reconcile-only<\/string>/);
  assert.equal((plist.match(/<integer>5<\/integer>/g) || []).length, 3);
  for (const { hour } of publicationScheduleEntries) {
    assert.match(plist, new RegExp(`<integer>${hour}</integer>`));
  }
});

test('publication reconciliation retries after each slot when YouTube visibility lags', () => {
  const reconciliationEntries = buildReconcileScheduleEntries(
    publicationScheduleEntries,
    DEFAULT_RECONCILE_DELAYS_MINUTES,
  );

  assert.deepEqual(reconciliationEntries, [
    { hour: 8, minute: 5 },
    { hour: 8, minute: 15 },
    { hour: 12, minute: 5 },
    { hour: 12, minute: 15 },
    { hour: 14, minute: 5 },
    { hour: 14, minute: 15 },
  ]);
});

test('scheduler wake times are derived from all active channel slots and handle rollover', () => {
  const profiles = [
    {
      status: 'active',
      schedule_slots: [
        { hour: 8, minute: 30 },
        { hour: 23, minute: 58 },
      ],
    },
    {
      status: 'active',
      schedule_slots: [
        { hour: 8, minute: 30 },
        { hour: 9, minute: 45 },
      ],
    },
    {
      status: 'paused',
      schedule_slots: [{ hour: 12, minute: 0 }],
    },
  ];

  const parentTimes = collectActivePublicationScheduleEntries(profiles);
  assert.deepEqual(parentTimes, [
    { hour: 8, minute: 30 },
    { hour: 9, minute: 45 },
    { hour: 23, minute: 58 },
  ]);
  assert.deepEqual(offsetScheduleEntries(parentTimes, 5), [
    { hour: 0, minute: 3 },
    { hour: 8, minute: 35 },
    { hour: 9, minute: 50 },
  ]);
});

test('Story continuation runs only after slots belonging to active Story-enabled profiles', () => {
  const storyTarget = (enabled) => ({
    platform: 'instagram_reels',
    enabled: true,
    instagram: { story: { enabled } },
  });
  const profiles = [
    {
      status: 'active',
      schedule_slots: [{ hour: 8, minute: 0 }, { hour: 23, minute: 50 }],
      metadata: { publisher: { targets: [storyTarget(true)] } },
    },
    {
      status: 'active',
      schedule_slots: [{ hour: 9, minute: 0 }],
      metadata: { publisher: { targets: [storyTarget(false)] } },
    },
    {
      status: 'paused',
      schedule_slots: [{ hour: 10, minute: 0 }],
      metadata: { publisher: { targets: [storyTarget(true)] } },
    },
  ];

  assert.deepEqual(collectActiveStoryContinuationScheduleEntries(profiles), [
    { hour: 0, minute: 10 },
    { hour: 8, minute: DEFAULT_STORY_CONTINUATION_DELAY_MINUTES },
  ]);
});

test('Story continuation plist invokes only the lightweight Story executor', () => {
  const storyScriptPath = '/Users/Agent/Workspace/ORION/services/product-video-agent/scripts/publication/social/instagram/execute-due-stories.mjs';
  const plist = buildPlistContent({
    ...plistOptions,
    label: STORY_CONTINUATION_PLIST_LABEL,
    scriptPath: storyScriptPath,
    scheduleEntries: [{ hour: 12, minute: 20 }],
  });

  assert.match(plist, new RegExp(`<string>${STORY_CONTINUATION_PLIST_LABEL}</string>`));
  assert.match(plist, new RegExp(`<string>${storyScriptPath}</string>`));
  assert.doesNotMatch(plist, /run-video-publication-scheduler/);
  assert.doesNotMatch(plist, /--reconcile-only/);
});
