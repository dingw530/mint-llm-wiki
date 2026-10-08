/**
 * 解析评测运行次数。
 * @param runsValue CLI 传入的运行次数文本
 * @param live 是否为 live 评测
 * @returns 经过校验的运行次数
 * @throws 当运行次数不是正整数，或 live 评测使用了不支持的次数时抛出错误
 */
export function resolveRuns(runsValue: string | undefined, live: boolean): number {
  const runs = Number(runsValue || (live ? 3 : 1));
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  if (live && runs !== 1 && runs !== 3) throw new Error('Live evaluation supports --runs 1 or --runs 3');
  return runs;
}
