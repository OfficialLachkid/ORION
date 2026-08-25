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

// selfDeclaredMadeForKids answers Studio's mandatory "Made for kids"
// audience declaration question. When it's undeclared, Studio's edit
// page shows a red "You need to answer this question" gate that keeps
// the Save button disabled for ANY change (related-video included) —
// so uploads that came in before ORION's pipeline started answering
// this at upload time can't have any Studio edit applied until the
// question is answered. This plan sets it to whatever the caller
// declares (typically false for the Pokemon channels).
export function buildYoutubeAudienceDeclarationUpdatePlan(externalId, madeForKids) {
  return {
    action: 'videos.update',
    scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    part: ['status'],
    body: {
      id: String(externalId || '').trim(),
      status: {
        selfDeclaredMadeForKids: Boolean(madeForKids),
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
