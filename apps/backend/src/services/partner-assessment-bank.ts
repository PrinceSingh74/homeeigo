export type AssessmentQuestion = {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
};

type BankQuestion = AssessmentQuestion & { correct: string };

const GENERAL: BankQuestion[] = [
  {
    id: "q1",
    prompt: "A customer is not home when you arrive. What do you do first?",
    options: [
      { id: "a", label: "Leave immediately without informing anyone" },
      { id: "b", label: "Call the customer, wait a few minutes, then update HOMEEIGO" },
      { id: "c", label: "Enter the house if the door is open" },
      { id: "d", label: "Start the next job and ignore this one" },
    ],
    correct: "b",
  },
  {
    id: "q2",
    prompt: "Before starting work, you should:",
    options: [
      { id: "a", label: "Confirm the job details and walk through the work with the customer" },
      { id: "b", label: "Begin immediately to save time" },
      { id: "c", label: "Ask the customer to leave the room and not ask questions" },
      { id: "d", label: "Collect cash first, even if the app says prepaid" },
    ],
    correct: "a",
  },
  {
    id: "q3",
    prompt: "If a job needs extra parts not in the original booking, you should:",
    options: [
      { id: "a", label: "Add charges later without telling anyone" },
      { id: "b", label: "Explain the need, get customer confirmation, then proceed" },
      { id: "c", label: "Cancel the job immediately" },
      { id: "d", label: "Use leftover parts from a previous house" },
    ],
    correct: "b",
  },
  {
    id: "q4",
    prompt: "Customer safety and professionalism means:",
    options: [
      { id: "a", label: "Wearing ID, using clean tools, and protecting floors/furniture" },
      { id: "b", label: "Working as fast as possible even if messy" },
      { id: "c", label: "Asking personal questions to build rapport" },
      { id: "d", label: "Sharing customer address with friends" },
    ],
    correct: "a",
  },
  {
    id: "q5",
    prompt: "After finishing a job you should:",
    options: [
      { id: "a", label: "Leave without showing the work" },
      { id: "b", label: "Mark complete in the app, show the result, and share aftercare tips" },
      { id: "c", label: "Ask the customer to tip in cash only" },
      { id: "d", label: "Stay until the next booking is assigned" },
    ],
    correct: "b",
  },
];

const SKILL_BANKS: Record<string, BankQuestion[]> = {
  electrician: [
    {
      id: "e1",
      prompt: "Before working on a switch or socket, you should:",
      options: [
        { id: "a", label: "Turn off the relevant MCB and confirm power is off" },
        { id: "b", label: "Work live to diagnose faster" },
        { id: "c", label: "Ask the customer to hold the wire" },
        { id: "d", label: "Only switch off the light, not the MCB" },
      ],
      correct: "a",
    },
    {
      id: "e2",
      prompt: "A burning smell from a board usually means:",
      options: [
        { id: "a", label: "The fan is dusty" },
        { id: "b", label: "Possible overload or loose connection — isolate and inspect" },
        { id: "c", label: "Nothing urgent" },
        { id: "d", label: "Add a higher rating fuse and continue" },
      ],
      correct: "b",
    },
    ...GENERAL.slice(2),
  ],
  plumbing: [
    {
      id: "p1",
      prompt: "A leaking joint after a repair should be:",
      options: [
        { id: "a", label: "Painted over" },
        { id: "b", label: "Re-checked under pressure and sealed correctly" },
        { id: "c", label: "Ignored if drip is slow" },
        { id: "d", label: "Left for the next technician" },
      ],
      correct: "b",
    },
    {
      id: "p2",
      prompt: "Before opening a drain, you should:",
      options: [
        { id: "a", label: "Protect the floor and confirm the blockage location with the customer" },
        { id: "b", label: "Pour acid immediately" },
        { id: "c", label: "Break the tile first" },
        { id: "d", label: "Skip PPE to save time" },
      ],
      correct: "a",
    },
    ...GENERAL.slice(2),
  ],
  cleaning: [
    {
      id: "c1",
      prompt: "For kitchen counters you should:",
      options: [
        { id: "a", label: "Use food-safe cleaner and wipe dry" },
        { id: "b", label: "Use toilet cleaner for extra shine" },
        { id: "c", label: "Skip if they look clean" },
        { id: "d", label: "Soak electronics in water" },
      ],
      correct: "a",
    },
    {
      id: "c2",
      prompt: "Customer valuables in the room should be:",
      options: [
        { id: "a", label: "Moved without asking" },
        { id: "b", label: "Left in place or moved only with permission" },
        { id: "c", label: "Taken outside for better cleaning" },
        { id: "d", label: "Photographed for social media" },
      ],
      correct: "b",
    },
    ...GENERAL.slice(2),
  ],
};

const SKILL_ALIASES: Record<string, string> = {
  electrician: "electrician",
  electrical: "electrician",
  plumbing: "plumbing",
  plumber: "plumbing",
  cleaning: "cleaning",
  "deep-cleaning": "cleaning",
  salon: "general",
  beauty: "general",
  "ac-repair": "general",
  ac: "general",
  carpentry: "general",
  "appliance-repair": "general",
};

export function normalizeAssessmentSkill(skill?: string | null): string {
  const raw = (skill ?? "general").trim().toLowerCase();
  return SKILL_ALIASES[raw] ?? (SKILL_BANKS[raw] ? raw : "general");
}

function bankFor(skillSlug: string): BankQuestion[] {
  return SKILL_BANKS[normalizeAssessmentSkill(skillSlug)] ?? GENERAL;
}

export function getPublicAssessmentQuestions(skillSlug: string): {
  skillSlug: string;
  passScore: number;
  questions: AssessmentQuestion[];
} {
  const slug = normalizeAssessmentSkill(skillSlug);
  return {
    skillSlug: slug,
    passScore: 60,
    questions: bankFor(slug).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: q.options,
    })),
  };
}

export function assertAssessmentAnswersComplete(
  skillSlug: string,
  answers: Record<string, string>,
): void {
  const pack = getPublicAssessmentQuestions(skillSlug);
  const missing = pack.questions.some((q) => !answers[q.id]?.trim());
  if (missing) {
    throw new Error("VALIDATION:Answer every question before submitting");
  }
}

export function scoreAssessment(
  skillSlug: string,
  answers: Record<string, string>,
): {
  skillSlug: string;
  score: number;
  maxScore: number;
  passed: boolean;
  correctCount: number;
  total: number;
} {
  const slug = normalizeAssessmentSkill(skillSlug);
  const bank = bankFor(slug);
  let correctCount = 0;
  for (const question of bank) {
    if (answers[question.id] === question.correct) correctCount += 1;
  }
  const score = bank.length === 0 ? 0 : Math.round((correctCount / bank.length) * 100);
  return {
    skillSlug: slug,
    score,
    maxScore: 100,
    passed: score >= 60,
    correctCount,
    total: bank.length,
  };
}
