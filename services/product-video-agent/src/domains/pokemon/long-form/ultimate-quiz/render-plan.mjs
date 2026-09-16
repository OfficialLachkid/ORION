export function buildUltimateQuizRenderPlan({ plan, template, outputPath }) {
  const width = Number(template?.canvas?.width || plan?.media_profile?.width || 1920);
  const height = Number(template?.canvas?.height || plan?.media_profile?.height || 1080);
  const fps = Number(template?.canvas?.fps || plan?.media_profile?.fps || 30);
  const totalDuration = Number(plan?.timing?.total_duration_seconds || 0);
  if (totalDuration < 480) {
    throw new Error(`Long-form render plan must be at least 480 seconds; received ${totalDuration}.`);
  }
  return {
    canvas: { width, height, fps },
    total_duration_seconds: totalDuration,
    phases: {
      hook: {
        start_seconds: 0,
        end_seconds: Number(plan?.timing?.intro_duration_seconds || 12),
      },
      outro: {
        start_seconds: Number(plan?.timing?.outro_start_seconds || totalDuration - 16),
        end_seconds: totalDuration,
      },
    },
    chapters: Array.isArray(plan?.chapters) ? plan.chapters : [],
    rounds: Array.isArray(plan?.rounds) ? plan.rounds : [],
    output_path: outputPath,
  };
}
