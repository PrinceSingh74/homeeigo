export function filterAcademyModulesForCategories<T extends { categoryIds: string[] }>(
  modules: T[],
  serviceCategories: string[] | null | undefined,
): T[] {
  const cats = serviceCategories ?? [];
  return modules.filter(
    (m) => m.categoryIds.length === 0 || m.categoryIds.some((c) => cats.includes(c)),
  );
}

export function academyTrainingState(
  publishedModules: Array<{ id: string; categoryIds: string[] }>,
  serviceCategories: string[] | null | undefined,
  progress: Array<{ moduleId: string; completedAt: Date | null }>,
) {
  const applicable = filterAcademyModulesForCategories(publishedModules, serviceCategories);
  const requiredModules = applicable.length;
  const ids = new Set(applicable.map((m) => m.id));
  const completedCount = progress.filter((p) => p.completedAt && ids.has(p.moduleId)).length;
  return {
    requiredModules,
    completedCount,
    trainingComplete: requiredModules === 0 || completedCount >= requiredModules,
  };
}
