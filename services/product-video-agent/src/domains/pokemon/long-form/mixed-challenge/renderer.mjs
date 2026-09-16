import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../process-runner.mjs';

export function buildMixedChallengeConcatFilter(sectionCount) {
  const count = Math.max(1, Number.parseInt(String(sectionCount), 10) || 1);
  const filters = [];
  const concatInputs = [];
  for (let index = 0; index < count; index += 1) {
    filters.push(`[${index}:v]setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
  }
  filters.push(`${concatInputs.join('')}concat=n=${count}:v=1:a=1[vout][aout]`);
  return `${filters.join(';\n')}\n`;
}

export async function assembleMixedChallengeVideo({
  sectionPaths,
  outputPath,
  template,
  ffmpegExecutable = 'ffmpeg',
  projectRoot,
  runtimeRoot,
  runProcess = runLocalProcess,
}) {
  if (!Array.isArray(sectionPaths) || sectionPaths.length === 0) {
    throw new Error('At least one rendered landscape section is required.');
  }
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const filterPath = resolve(runtimeRoot, 'mixed-challenge-concat.filters.txt');
  await mkdir(dirname(filterPath), { recursive: true });
  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  await writeFile(filterPath, buildMixedChallengeConcatFilter(sectionPaths.length), 'utf8');
  await runProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...sectionPaths.flatMap((sectionPath) => ['-i', sectionPath]),
      '-/filter_complex',
      filterPath,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-r',
      String(template?.canvas?.fps || 30),
      '-c:v',
      String(template?.renderer?.video_codec || 'libx264'),
      '-preset',
      String(template?.renderer?.preset || 'fast'),
      '-crf',
      String(template?.renderer?.crf ?? 21),
      '-pix_fmt',
      String(template?.renderer?.pixel_format || 'yuv420p'),
      '-c:a',
      String(template?.renderer?.audio_codec || 'aac'),
      '-b:a',
      String(template?.renderer?.audio_bitrate || '192k'),
      '-movflags',
      '+faststart',
      outputAbsolutePath,
    ],
    cwd: projectRoot,
    timeoutMs: 7_200_000,
  });
  await access(outputAbsolutePath);
  return {
    output_path: outputAbsolutePath,
    concat_filter_path: filterPath,
    section_paths: sectionPaths,
  };
}
