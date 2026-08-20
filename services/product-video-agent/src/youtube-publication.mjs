function joinDescription(description, hashtags = []) {
  const base = String(description || '').trim();
  const tagLine = Array.isArray(hashtags) && hashtags.length > 0
    ? hashtags.join(' ')
    : '';
  return [base, tagLine].filter(Boolean).join('\n\n');
}

export function buildYoutubePreviewUploadPlan(publication, channelProfile) {
  return {
    action: 'videos.insert',
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    part: ['snippet', 'status'],
    body: {
      snippet: {
        title: publication.title,
        description: joinDescription(publication.description, publication.hashtags),
        categoryId: channelProfile.youtube.default_category_id,
        defaultLanguage: channelProfile.language,
        tags: publication.hashtags || [],
      },
      // Unlisted is the shareable preview state for Discord review. Private
      // uploads cannot act as generic operator preview links.
      status: {
        privacyStatus: channelProfile.workflow.preview_visibility,
      },
    },
  };
}

export function buildYoutubeScheduleUpdatePlan(publication, scheduledFor) {
  return {
    action: 'videos.update',
    scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    part: ['status'],
    body: {
      id: publication.external_id,
      // Scheduling uses private + publishAt. After the scheduled time,
      // YouTube makes the video public automatically.
      status: {
        privacyStatus: 'private',
        publishAt: new Date(scheduledFor).toISOString(),
      },
    },
  };
}

export function buildYoutubeCommentInsertPlan(videoId, textOriginal) {
  return {
    action: 'commentThreads.insert',
    scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    part: ['snippet'],
    body: {
      snippet: {
        videoId,
        topLevelComment: {
          snippet: {
            textOriginal: String(textOriginal || '').trim(),
          },
        },
      },
    },
  };
}
