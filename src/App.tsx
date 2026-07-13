import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { playPronunciation, preferredAudioSource, stopPronunciation } from "./audio";
import { loadVocabularyCatalog } from "./catalog";
import { downloadBackup, loadAppData, readBackup, replaceAppData, resetAppData, saveAppData } from "./db";
import { greMatchLocationLabel } from "./gre-question-display";
import { mergeImport, previewVocabularyImport, type ImportPreview } from "./importers";
import { enqueueRecoverableSave } from "./persistence-queue";
import {
  MOCK_MISTAKE_CAUSES,
  MOCK_QUESTION_TYPES,
  activateMockMistake,
  aggregateMockMistakeStats,
  applyMockMistakeReview,
  createMockMistakeDraftFromOcr,
  createSafeMockMistakeExport,
  isMockMistakeReady,
  mockAnswerFromText,
  normalizeStoredMockMistakes,
  sortDueMockMistakes,
  submitMockMistakeAttempt,
  type MockAnswer,
  type MockMistakeAttachment,
  type MockMistakeCause,
  type MockMistakeRecord,
  type MockMistakeReviewOutcome,
  type MockQuestionType,
} from "./mock-mistakes";
import { applyDefinitionQuizAnswer, createDefinitionQuizQuestion, type DefinitionQuizEvaluation } from "./quiz";
import { buildDailyQueue, createDailyPlan, createLearningState, ensureDailyPlan, findSense, greQuestionMatchesFor, isQuizTargetSense, isStudyReadySense, localDateKey, studyExamplesFor } from "./scheduler";
import {
  collectRemainingPrimaryTargets,
  forecastRemainingPrimaryTargets,
  normalizeDailyNewWordGoal,
  persistAdditionalNewWordBatch,
  restoreActiveStudySession,
  selectAdditionalNewWordBatch,
  updateActiveStudySessionProgress,
} from "./study-goal";
import {
  createEmptyData,
  stableId,
  type AppData,
  type QueueItem,
  type PronunciationAudio,
  type Rating,
  type RelationNotes,
  type ReviewEvent,
  type WordEntry,
  type WordSense,
} from "./types";
import {
  BookOpenIcon,
  BrainIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  HistoryIcon,
  InfoIcon,
  NetworkIcon,
  ProgressIcon,
  SettingsIcon,
  SparklesIcon,
  TargetIcon,
  VolumeIcon,
} from "./ui-icons";

type Tab = "today" | "import" | "library" | "mistakes" | "progress" | "settings";

const tabLabels: Array<{ id: Tab; label: string; icon: typeof SparklesIcon }> = [
  { id: "today", label: "今日", icon: SparklesIcon },
  { id: "library", label: "词义图谱", icon: NetworkIcon },
  { id: "mistakes", label: "错题本", icon: HistoryIcon },
  { id: "progress", label: "学习轨迹", icon: ProgressIcon },
  { id: "settings", label: "设置", icon: SettingsIcon },
];

interface PageHeadingProps {
  icon: typeof SparklesIcon;
  kicker: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  chips?: Array<{ label: string; icon: typeof SparklesIcon }>;
  className?: string;
}

function PageHeading({ icon: HeadingIcon, kicker, title, description, action, chips, className = "" }: PageHeadingProps) {
  return (
    <div className={`page-heading page-heading-refined ${className}`.trim()}>
      <div className="page-heading-copy">
        <div className="heading-kicker"><span className="heading-icon"><HeadingIcon size={18} /></span><span>{kicker}</span></div>
        <h1>{title}</h1>
        <p className="heading-description">{description}</p>
        {chips?.length ? <div className="heading-chips">{chips.map((chip) => {
          const ChipIcon = chip.icon;
          return <span key={chip.label}><ChipIcon size={14} />{chip.label}</span>;
        })}</div> : null}
      </div>
      {action}
    </div>
  );
}

const ratingLabels: Record<Rating, { label: string; hint: string; key: string }> = {
  again: { label: "答错", hint: "10分钟后再来", key: "1" },
  hard: { label: "答对·未稳", hint: "需要再次确认", key: "2" },
  good: { label: "稳定记得", hint: "正常推进", key: "3" },
  easy: { label: "流畅掌握", hint: "显著延长", key: "4" },
};

const mockQuestionTypeLabels: Record<MockQuestionType, string> = {
  TC: "填空 TC",
  SE: "句子等价 SE",
  RC: "阅读 RC",
  CR: "逻辑单题 CR",
  Quant: "数学 Quant",
  AWA: "写作 AWA",
  Other: "其他",
};

const mockMistakeCauseLabels: Record<MockMistakeCause, string> = {
  vocabulary: "词汇不认识或义项混淆",
  sentence_logic: "句间逻辑 / 转折判断",
  passage_comprehension: "文章理解偏差",
  evidence_location: "定位证据错误",
  option_trap: "掉进干扰项陷阱",
  concept_gap: "知识点缺口",
  calculation: "计算错误",
  time_pressure: "时间压力",
  careless: "粗心或漏读条件",
  guessing: "无依据猜测",
  other: "其他",
};

interface MockMistakeFormState {
  questionType: MockQuestionType;
  sourceLabel: string;
  mockName: string;
  questionNumber: string;
  passageText: string;
  questionText: string;
  optionsText: string;
  userAnswer: string;
  correctAnswer: string;
  errorCause: MockMistakeCause;
  correctReasoning: string;
  trapAnalysis: string;
  improvementPlan: string;
  linkedHeadwords: string;
}

interface MockReviewDraftState {
  answer: MockAnswer;
  submitted: boolean;
  isCorrect: boolean | null;
}

const emptyMockMistakeForm = (): MockMistakeFormState => ({
  questionType: "TC",
  sourceLabel: "",
  mockName: "",
  questionNumber: "",
  passageText: "",
  questionText: "",
  optionsText: "",
  userAnswer: "",
  correctAnswer: "",
  errorCause: "vocabulary",
  correctReasoning: "",
  trapAnalysis: "",
  improvementPlan: "",
  linkedHeadwords: "",
});

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("截图读取失败。"));
    reader.readAsDataURL(file);
  });
}

function formatDate(value: string | null): string {
  if (!value) return "尚未学习";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean))];
}

function highlightTarget(text: string, headword: string) {
  const escaped = headword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(\\b${escaped}(?:s|es|d|ed|ing|ly|er|est|ness)?\\b)`, "gi"));
  return parts.map((part, index) => index % 2 ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

function exampleKindLabel(kind: string): string {
  if (kind === "gre_official") return "ETS / GRE 本地来源";
  if (kind === "screen_dialogue") return "授权影视语境";
  if (kind === "dictionary") return "开放词典例句";
  if (kind === "original_gre_style") return "项目原创 GRE 风格（非真题）";
  return "其他来源";
}

function greQuestionTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    text_completion: "填空 TC",
    sentence_equivalence: "句子等价 SE",
    reading_multiple_choice: "阅读单选 RC",
    reading_select_all: "阅读多选 RC",
    reading_sentence_selection: "句子选择 RC",
  };
  return labels[value] ?? value;
}

function GreQuestionEvidence({ sense, headword, compact = false }: { sense: WordSense; headword: string; compact?: boolean }) {
  const matches = greQuestionMatchesFor(sense);
  if (!matches.length) {
    const stats = sense.greQuestionMatchStats;
    if (stats?.corpusReviewState === "pending_review") {
      return <div className={`gre-question-empty${compact ? " compact" : ""}`}><strong>本地机经：有候选，尚待逐题语义审核</strong><p>已扫描到 {stats.exactCorpusMatches} 个原形题目、{stats.inflectionCandidates} 个规则词形候选；其中 {stats.unreviewedCandidates} 个尚未核对到当前义项，因此暂不展示为已匹配原文。</p></div>;
    }
    if (stats?.corpusReviewState === "reviewed") {
      return <div className={`gre-question-empty${compact ? " compact" : ""}`}><strong>本地机经：候选已审核</strong><p>已核对 {stats.reviewedBindings} 个候选，但没有可展示的当前义项题文；系统不会用开放词典例句冒充机经。</p></div>;
    }
    if (compact) return null;
    if (stats?.corpusReviewState === "scanned_no_candidate") {
      return <div className="gre-question-empty"><strong>本地机经：已扫描，无候选</strong><p>在当前已解析的本地题库中，未发现该词原形或本系统覆盖的保守规则词形；这不代表已覆盖所有不规则变形。</p></div>;
    }
    return <div className="gre-question-empty"><strong>本地机经：尚无扫描状态</strong><p>当前个人词库尚未写入这一义项的题库扫描统计。</p></div>;
  }
  const visible = matches.slice(0, compact ? 1 : 3);
  return <section className={`gre-question-evidence${compact ? " compact" : ""}`}>
    <div className="gre-question-heading"><div><span>本地 GRE 机经题库原文</span><small>私人回忆 / 练习资料，不标作 ETS 官方真题</small></div><b>{matches.filter((match) => match.senseMatchState === "confirmed_sense").length} 个义项确认 · {matches.length} 个展示匹配</b></div>
    {visible.map((match) => <details key={match.id} open={!compact && match.senseMatchState === "confirmed_sense"}>
      <summary><span className={match.senseMatchState}>{match.senseMatchState === "confirmed_sense" ? "该义项已逐题确认" : "仅确认词形出现"}</span><strong>{greQuestionTypeLabel(match.questionType)} · {match.locator}</strong></summary>
      <div className="gre-question-content">
        {match.passageText && <blockquote>{highlightTarget(match.passageText, match.matchedSurface || headword)}</blockquote>}
        <p className="gre-question-stem">{highlightTarget(match.questionText, match.matchedSurface || headword)}</p>
        <ol>{match.options.map((option) => <li key={`${match.id}-${option.label}`} className={match.answerValues?.includes(option.label) ? "answer" : ""}><b>{option.label}</b><span>{highlightTarget(option.text, match.matchedSurface || headword)}</span>{match.answerValues?.includes(option.label) && <em>答案</em>}</li>)}</ol>
        {!match.options.length && match.answerValues?.length && <p className="gre-sentence-answer"><b>答案定位：</b>{match.answerValues.join("；")}</p>}
        <div className="gre-question-review"><span>命中：{match.matchLocations.map(greMatchLocationLabel).join(" · ")}</span><span>{match.reviewNote}</span></div>
        <small>{match.sourceLabel} · {match.sourceFile} · PDF 第 {match.pageStart}{match.pageEnd !== match.pageStart ? `–${match.pageEnd}` : ""} 页</small>
      </div>
    </details>)}
    {!compact && matches.length > visible.length && <p className="gre-question-more">另有 {matches.length - visible.length} 个已索引匹配；当前界面优先展示已逐题确认义项和高质量题目。</p>}
  </section>;
}

function trustedPronunciations(word: WordEntry) {
  return word.pronunciations.filter((item) => (
    (item.quality === "dictionary_ipa" && item.reviewState === "source_verified")
    || (item.quality === "editor_reviewed" && item.reviewState === "editor_reviewed")
  ));
}

type RelationKind = "synonyms" | "antonyms";

const relationKindLabels: Record<RelationKind, string> = {
  synonyms: "同义词",
  antonyms: "反义词",
};

function relationMissingLabel(sense: WordSense, kind: RelationKind): string {
  const evidence = sense.relationEvidence?.[kind];
  if (evidence?.state === "source_checked_absent") {
    return `已核验：OEWN 此义项未收录直接${relationKindLabels[kind]}`;
  }
  if (evidence?.state === "verified_present") return "关系数据状态异常，已停止用于正式学习";
  return "尚未通过来源核验，已退出正式学习";
}

function relationEvidenceLabel(sense: WordSense, kind: RelationKind): string {
  const state = sense.relationEvidence?.[kind]?.state;
  if (state === "verified_present") return `${relationKindLabels[kind]}：来源已核验`;
  if (state === "source_checked_absent") return `${relationKindLabels[kind]}：来源已检查，未收录直接关系`;
  if (sense.relationState === "user_supplied") return `${relationKindLabels[kind]}：个人补充，未作为词典证据核验`;
  return `${relationKindLabels[kind]}：尚未核验`;
}

function RelationEvidence({ sense }: { sense: WordSense }) {
  return <div className="relation-evidence">
    {(["synonyms", "antonyms"] as RelationKind[]).map((kind) => {
      const evidence = sense.relationEvidence?.[kind];
      return <div key={kind} className={evidence?.state ?? "unverified"}>
        <b>{relationEvidenceLabel(sense, kind)}</b>
        <span>{evidence?.source || "未提供可核验来源"}</span>
      </div>;
    })}
  </div>;
}

function ConfusableEvidence({ data, sense }: { data: AppData; sense: WordSense }) {
  const rows = (sense.confusableSenseIds ?? []).flatMap((senseId) => {
    const found = findSense(data, senseId);
    const rationale = sense.confusableRationales?.[senseId]?.trim();
    return found && rationale ? [{ ...found, rationale }] : [];
  });
  if (!rows.length) return null;
  return <div className="confusable-evidence">
    <div><b>为什么容易混淆</b><span>逐义项编辑审核 · 绑定到具体词义</span></div>
    {rows.map(({ word, sense: candidate, rationale }) => <article key={candidate.id}>
      <div><strong>{word.headword}</strong><span>{candidate.definitionZh}</span></div>
      <p>{rationale}</p>
    </article>)}
  </div>;
}

function mockAnswerLabel(record: MockMistakeRecord): string {
  const byId = new Map(record.options.map((option) => [option.id, option]));
  const structured = record.correctAnswer.optionIds.flatMap((id) => {
    const option = byId.get(id);
    return option ? [`${option.label}. ${option.text}`] : [];
  });
  return structured.join("；") || record.correctAnswer.text?.trim() || "尚未记录";
}

function MockMistakeCard({
  record,
  isDue,
  reviewDraft,
  onAnswerChange,
  onSubmitAnswer,
  onRate,
  onEdit,
}: {
  record: MockMistakeRecord;
  isDue: boolean;
  reviewDraft?: MockReviewDraftState;
  onAnswerChange: (answer: MockAnswer) => void;
  onSubmitAnswer: () => void;
  onRate: (outcome: MockMistakeReviewOutcome) => void;
  onEdit: () => void;
}) {
  const persistedReviewDraft: MockReviewDraftState | undefined = record.pendingGradedAttempt
    ? { answer: record.pendingGradedAttempt.answer, submitted: true, isCorrect: true }
    : undefined;
  const activeReviewDraft = reviewDraft ?? persistedReviewDraft;
  const answer = activeReviewDraft?.answer ?? { optionIds: [], text: "" };
  const submitted = Boolean(activeReviewDraft?.submitted);
  const showSolution = !isDue || submitted;
  const hasAnswer = answer.optionIds.length > 0 || Boolean(answer.text?.trim());
  const toggleOption = (optionId: string) => {
    if (submitted) return;
    const selected = new Set(answer.optionIds);
    if (selected.has(optionId)) selected.delete(optionId);
    else selected.add(optionId);
    onAnswerChange({ ...answer, optionIds: [...selected] });
  };

  return <article className={`mock-record ${record.status}${isDue ? " due" : ""}`}>
    <div className="mock-record-top"><div><span className="question-type-badge">{mockQuestionTypeLabels[record.questionType]}</span><span className={`status-badge ${record.status}`}>{record.status === "draft" ? "待补全" : record.status === "mastered" ? "已掌握·待抽查" : record.status === "archived" ? "已归档" : isDue ? "现在重做" : "已安排"}</span></div><strong>{Math.round(record.mastery * 100)}%</strong></div>
    <div className="mock-record-body">{record.attachments[0]?.localDataUrl && (showSolution ? <img src={record.attachments[0].localDataUrl} alt="本地错题截图" /> : <div className="mock-shot-hidden"><b>截图已隐藏</b><span>提交本次答案后再显示，避免截图中的标记泄露答案。</span></div>)}<div><h3>{record.questionText || "只有截图，题干尚未校对"}</h3><p>{[record.source.label, record.source.mockName, record.source.questionNumber].filter(Boolean).join(" · ") || "来源待补充"}</p>{showSolution && <small>正确答案：{mockAnswerLabel(record)}</small>}</div></div>
    {isDue && record.passageText && <blockquote className="mock-review-passage">{record.passageText}</blockquote>}
    {isDue && record.options.length > 0 && <div className="mock-review-options" aria-label="本次重做选项">{record.options.map((option) => <button type="button" key={option.id} className={answer.optionIds.includes(option.id) ? "selected" : ""} aria-pressed={answer.optionIds.includes(option.id)} disabled={submitted} onClick={() => toggleOption(option.id)}><b>{option.label}</b><span>{option.text}</span></button>)}</div>}
    {isDue && !submitted && <div className="mock-review-answer"><p>先独立作答。提交前不会显示答案和解析；多选题可选择多个选项。</p>{record.options.length === 0 && <label>本次答案<input value={answer.text ?? ""} onChange={(event) => onAnswerChange({ optionIds: [], text: event.target.value })} placeholder="输入本次答案" /></label>}<button className="primary-button" disabled={!hasAnswer} onClick={onSubmitAnswer}>提交重做答案</button></div>}
    {isDue && submitted && <div className={`mock-review-feedback ${activeReviewDraft?.isCorrect ? "correct" : "incorrect"}`}><strong>{activeReviewDraft?.isCorrect ? "本次答对" : "本次答错"}</strong><p>系统已按正确答案判分。正确答案：{mockAnswerLabel(record)}</p></div>}
    {showSolution && record.analysis.correctReasoning && <details><summary>查看解析与改进</summary><p><b>正确思路：</b>{record.analysis.correctReasoning}</p>{record.analysis.trapAnalysis && <p><b>陷阱：</b>{record.analysis.trapAnalysis}</p>}{record.analysis.improvementPlan && <p><b>下次：</b>{record.analysis.improvementPlan}</p>}</details>}
    <div className="mock-record-meta"><span>{record.errorCauses.map((cause) => mockMistakeCauseLabels[cause]).join(" · ")}</span><span>{record.status === "draft" ? "补全后进入复习" : `下次：${formatDate(record.nextReviewAt)}`}</span></div>
    <div className="mock-record-actions">{!isDue && <button className="secondary-button" onClick={onEdit}>编辑 / 校对</button>}{isDue && submitted && activeReviewDraft?.isCorrect && <><button onClick={() => onRate("hard")}>做对但吃力</button><button onClick={() => onRate("good")}>稳定做对</button><button onClick={() => onRate("easy")}>快速掌握</button></>}</div>
  </article>;
}

function App() {
  const [data, setData] = useState<AppData>(createEmptyData());
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const saveQueue = useRef(Promise.resolve());
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [selectedSenseId, setSelectedSenseId] = useState<string | null>(null);
  const [relationDraft, setRelationDraft] = useState({ synonyms: "", antonyms: "", confusables: "", contextNote: "" });
  const [sessionQueue, setSessionQueue] = useState<QueueItem[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<DefinitionQuizEvaluation | null>(null);
  const [cardStartedAt, setCardStartedAt] = useState(Date.now());
  const [sessionComplete, setSessionComplete] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioMessage, setAudioMessage] = useState("");
  const [discoveredAudio, setDiscoveredAudio] = useState<{ wordId: string; source: PronunciationAudio } | null>(null);
  const repeatedInSession = useRef(new Set<string>());
  const [mistakeHeadword, setMistakeHeadword] = useState("");
  const [mistakeReason, setMistakeReason] = useState("未知词义");
  const [mistakeNote, setMistakeNote] = useState("");
  const [mistakePanel, setMistakePanel] = useState<"mock" | "vocabulary">("mock");
  const [mockForm, setMockForm] = useState<MockMistakeFormState>(emptyMockMistakeForm);
  const [mockAttachment, setMockAttachment] = useState<MockMistakeAttachment | null>(null);
  const [mockAttachmentCleared, setMockAttachmentCleared] = useState(false);
  const [editingMockMistakeId, setEditingMockMistakeId] = useState<string | null>(null);
  const [mockAttachmentBusy, setMockAttachmentBusy] = useState(false);
  const [mockReviewDrafts, setMockReviewDrafts] = useState<Record<string, MockReviewDraftState>>({});
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [dailyGoalDraft, setDailyGoalDraft] = useState(20);
  const [additionalBatchSize, setAdditionalBatchSize] = useState(20);
  const [notice, setNotice] = useState("");

  const loadStudyStateIntoUi = (nextData: AppData) => {
    const restored = restoreActiveStudySession(nextData);
    const goal = normalizeDailyNewWordGoal(nextData.settings.dailyNewWords);
    setData(nextData);
    setDailyGoalDraft(goal);
    setAdditionalBatchSize(goal);
    setAnswerFeedback(null);
    setSessionComplete(false);
    setAudioMessage("");
    setDiscoveredAudio(null);
    setMockReviewDrafts({});
    setCardStartedAt(Date.now());
    if (!restored) {
      setSessionQueue([]);
      setSessionIndex(0);
      setActiveSessionId(null);
      repeatedInSession.current = new Set();
      return null;
    }

    setSessionQueue(restored.queue);
    setSessionIndex(restored.session.nextIndex);
    setActiveSessionId(restored.session.id);
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const senseId of restored.session.queueSenseIds) {
      if (seen.has(senseId)) repeated.add(senseId);
      seen.add(senseId);
    }
    repeatedInSession.current = repeated;
    return restored;
  };

  useEffect(() => {
    loadVocabularyCatalog()
      .then((catalog) => loadAppData(catalog))
      .then(async (saved) => {
        const planned = ensureDailyPlan(saved);
        const restored = loadStudyStateIntoUi(planned);
        if (restored) {
          setNotice(`已恢复上次续学，剩余 ${restored.queue.length - restored.session.nextIndex} 题。`);
        }
        if (planned !== saved) await saveAppData(planned);
      })
      .catch((error) => setStartupError(error instanceof Error ? error.message : "默认词汇数据库加载失败。"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const updateData = (transform: (previous: AppData) => AppData) => {
    setData((previous) => {
      const next = transform(previous);
      saveQueue.current = enqueueRecoverableSave(
        saveQueue.current,
        () => saveAppData(next),
        (error) => setNotice(error instanceof Error ? `本地保存失败：${error.message}` : "本地保存失败，请导出备份后重试。"),
      );
      return next;
    });
  };

  const dailyQueue = useMemo(() => buildDailyQueue(data), [data]);
  const dailyPlan = createDailyPlan(data);
  const studyForecast = useMemo(() => forecastRemainingPrimaryTargets(data, {
    includeStoredPlans: false,
    dailyNewWordGoal: data.settings.dailyNewWords,
  }), [data]);
  const extraNewWordCount = useMemo(
    () => collectRemainingPrimaryTargets(data, {
      includeStoredPlans: false,
      scheduledWordIds: dailyPlan.wordIds,
    }).length,
    [data, dailyPlan.wordIds],
  );
  const currentCard = sessionQueue[sessionIndex] ?? null;
  const currentQuestion = useMemo(() => {
    if (!currentCard) return null;
    try {
      const preferredDistractorSenseIds = [...new Set(data.reviewEvents
        .filter((event) => (
          event.senseId === currentCard.sense.id
          && event.isCorrect === false
          && Boolean(event.selectedSenseId)
          && (
            event.catalogVersion === data.catalogVersion
            || (currentCard.sense.confusableSenseIds ?? []).includes(event.selectedSenseId as string)
          )
        ))
        .sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))
        .map((event) => event.selectedSenseId as string))]
        .slice(0, 12);
      return createDefinitionQuizQuestion({
        word: currentCard.word,
        sense: currentCard.sense,
        catalogWords: data.words,
        attemptSeed: `${sessionIndex}|${currentCard.learning.reviewCount}|${currentCard.learning.lapseCount}`,
        preferredDistractorSenseIds,
      });
    } catch {
      return null;
    }
  }, [currentCard, data.reviewEvents, data.words, sessionIndex]);
  const currentExamples = currentCard ? studyExamplesFor(currentCard.word, currentCard.sense) : [];
  const audioSourceFor = (word: WordEntry) => discoveredAudio?.wordId === word.id
    ? discoveredAudio.source
    : preferredAudioSource(word);
  const currentAudio = currentCard ? audioSourceFor(currentCard.word) : null;
  const currentPronunciation = currentCard ? trustedPronunciations(currentCard.word)[0] ?? null : null;
  const currentLearningState = currentCard ? (data.learning[currentCard.sense.id] ?? currentCard.learning) : null;
  const learnedSenses = Object.values(data.learning).filter((state) => state.reviewCount > 0);
  const dueCount = useMemo(() => {
    const now = Date.now();
    return data.words.reduce((total, word) => total + word.senses.filter((sense) => {
      const state = data.learning[sense.id];
      return Boolean(
        state
        && state.reviewCount > 0
        && isQuizTargetSense(word, sense)
        && new Date(state.nextReviewAt).getTime() <= now,
      );
    }).length, 0);
  }, [data.learning, data.words]);
  const masteryAverage = learnedSenses.length
    ? Math.round(learnedSenses.reduce((sum, state) => sum + state.definitionMastery, 0) / learnedSenses.length)
    : 0;
  const formalWords = useMemo(() => data.words
    .map((word) => ({ ...word, senses: word.senses.filter((sense) => isStudyReadySense(word, sense)) }))
    .filter((word) => word.senses.length > 0), [data.words]);
  const contentReadyWords = useMemo(
    () => data.words.filter((word) => word.senses[0] && isQuizTargetSense(word, word.senses[0])).length,
    [data.words],
  );
  const formalSenseCount = useMemo(
    () => formalWords.reduce((sum, word) => sum + word.senses.length, 0),
    [formalWords],
  );
  const humanAudioWords = useMemo(() => data.words.filter((word) => preferredAudioSource(word)).length, [data.words]);
  const mockMistakeStats = useMemo(
    () => aggregateMockMistakeStats(data.mockMistakes, new Date(clockNowMs)),
    [clockNowMs, data.mockMistakes],
  );
  const dueMockMistakes = useMemo(
    () => sortDueMockMistakes(data.mockMistakes, new Date(clockNowMs)),
    [clockNowMs, data.mockMistakes],
  );
  const dueMockMistakeIds = useMemo(() => new Set(dueMockMistakes.map((record) => record.id)), [dueMockMistakes]);
  const otherMockMistakes = useMemo(() => data.mockMistakes
    .filter((record) => !dueMockMistakeIds.has(record.id))
    .sort((left, right) => Number(right.status === "draft") - Number(left.status === "draft") || right.updatedAt.localeCompare(left.updatedAt)), [data.mockMistakes, dueMockMistakeIds]);

  const filteredWords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return formalWords
      .filter((word) => !query || word.normalizedHeadword.includes(query) || word.senses.some((sense) => sense.definitionZh.includes(query)))
      .slice(0, 100);
  }, [formalWords, search]);

  const selectedWord = filteredWords.find((word) => word.id === selectedWordId) ?? filteredWords[0] ?? null;
  const selectedSense = selectedWord?.senses.find((sense) => sense.id === selectedSenseId) ?? selectedWord?.senses[0] ?? null;
  const selectedAudio = selectedWord ? audioSourceFor(selectedWord) : null;
  const examTargetMs = new Date(`${data.settings.examDate}T12:00:00`).getTime();
  const examDays = Number.isFinite(examTargetMs) ? Math.max(0, Math.ceil((examTargetMs - clockNowMs) / 86_400_000)) : 0;
  const todayHeading = currentCard
    ? answerFeedback
      ? answerFeedback.isCorrect
        ? { kicker: `今日练习 · ${sessionIndex + 1}/${sessionQueue.length}`, title: "认出来了，再把语境一起记住", description: "把这次识别和词义关系、例句及 GRE 语境连在一起。" }
        : { kicker: `今日练习 · ${sessionIndex + 1}/${sessionQueue.length}`, title: "这次混淆了，正好记得更牢", description: "先看清差异和语境；这次易混项会自动进入强化队列。" }
      : { kicker: `今日练习 · ${sessionIndex + 1}/${sessionQueue.length}`, title: "先凭记忆，选出最贴切的意思", description: "提交答案后，再展开释义、词义关系与语境证据。" }
    : sessionComplete
      ? { kicker: "随心续学", title: "这一轮完成了，想继续就再学一组", description: "进度已经保存；停在这里或继续探索，都不会打乱你的复习节奏。" }
      : { kicker: "今日节奏", title: "今天想学多少，由你决定", description: "设定新词量后，系统会把到期复习、高频重点与低频拓展重新组合。" };
  const currentCardCoachCopy = currentCard
    ? currentCard.isNew
      ? currentCard.word.frequencyProfile.tier === "focus"
        ? "这是第一次见面，也是一枚高频重点词。先凭直觉作答。"
        : "这是第一次见面。低频拓展词会穿插出现，帮你逐步扩大词汇边界。"
      : "它到了该回忆的时间，试着先从记忆里把意思找回来。"
    : "";

  useEffect(() => {
    if (selectedWord && selectedWordId !== selectedWord.id) setSelectedWordId(selectedWord.id);
  }, [filteredWords, selectedWord]);

  useEffect(() => {
    if (!selectedSense) return;
    setSelectedSenseId(selectedSense.id);
    setRelationDraft({
      synonyms: selectedSense.relations.synonyms.join(", "),
      antonyms: selectedSense.relations.antonyms.join(", "),
      confusables: selectedSense.relations.confusables.join(", "),
      contextNote: selectedSense.contextNote,
    });
  }, [selectedSense?.id]);

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setImportBusy(true);
    setImportMessage("");
    try {
      const preview = await previewVocabularyImport(files);
      setImportPreview(preview);
      setImportMessage("解析完成。确认统计后即可写入本机学习库。");
    } catch (error) {
      setImportPreview(null);
      setImportMessage(error instanceof Error ? error.message : "词库解析失败。");
    } finally {
      setImportBusy(false);
    }
  };

  const commitImport = () => {
    if (!importPreview) return;
    updateData((previous) => mergeImport(previous, importPreview));
    setImportMessage(`已导入 ${importPreview.stats.wordCount.toLocaleString()} 个词，学习数据仅保存在此浏览器。`);
    setImportPreview(null);
    setNotice("词库导入成功，已生成今日学习队列。");
    setTab("today");
  };

  const startQueue = (queue: QueueItem[], persistedSessionId: string | null = null) => {
    if (!queue.length) return;
    setSessionQueue(queue);
    setSessionIndex(0);
    setActiveSessionId(persistedSessionId);
    setAnswerFeedback(null);
    setCardStartedAt(Date.now());
    setSessionComplete(false);
    repeatedInSession.current = new Set();
  };

  const startSession = () => startQueue(buildDailyQueue(data), null);

  const confirmDailyGoal = () => {
    const goal = normalizeDailyNewWordGoal(dailyGoalDraft, data.settings.dailyNewWords);
    setDailyGoalDraft(goal);
    setAdditionalBatchSize(goal);
    setSessionComplete(false);
    updateData((previous) => ensureDailyPlan({
      ...previous,
      settings: { ...previous.settings, dailyNewWords: goal },
    }));
    setNotice(`今日新词目标已调整为 ${goal} 个，并重新计算完成日期。`);
  };

  const continueWithNewWords = () => {
    const requestedCount = normalizeDailyNewWordGoal(additionalBatchSize, data.settings.dailyNewWords);
    const batch = selectAdditionalNewWordBatch(data, {
      requestedCount,
      includeStoredPlans: false,
      scheduledWordIds: dailyPlan.wordIds,
      seedKey: `${localDateKey()}|extra|${data.reviewEvents.length}`,
    });
    if (!batch.targets.length) {
      setNotice("当前没有更多未学且通过内容校对门槛的新词。到期复习仍会自动出现。");
      return;
    }
    const now = new Date();
    const persisted = persistAdditionalNewWordBatch(data, batch, now);
    const restored = restoreActiveStudySession(persisted, now);
    if (!restored) {
      setNotice("续学批次未能安全写入今日计划，请重试。");
      return;
    }
    updateData(() => persisted);
    setAdditionalBatchSize(requestedCount);
    startQueue(restored.queue, restored.session.id);
    setNotice(`已追加 ${batch.selectedCount} 个新词：${batch.focusCount} 个重点词 + ${batch.longTailCount} 个长尾词。`);
  };

  const speak = async (word: WordEntry) => {
    if (audioBusy) return;
    setAudioBusy(true);
    setAudioMessage("正在加载发音…");
    try {
      const result = await playPronunciation(word, data.settings.audioPlaybackRate);
      setDiscoveredAudio(result.source ? { wordId: word.id, source: result.source } : null);
      setAudioMessage(!result.played ? result.label : result.human ? "真人录音播放完成。" : "未找到符合语言与许可要求的真人录音，已播放系统合成备用音。");
    } catch (error) {
      setAudioMessage(error instanceof Error ? error.message : "发音播放失败。");
    } finally {
      setAudioBusy(false);
    }
  };

  const answerQuestion = (selectedOptionId: string) => {
    if (!currentCard || !currentQuestion || answerFeedback) return;
    const now = new Date();
    const responseTimeMs = Math.max(300, Date.now() - cardStartedAt);
    const currentLearning = data.learning[currentCard.sense.id] ?? currentCard.learning;
    const result = applyDefinitionQuizAnswer({
      question: currentQuestion,
      selectedOptionId,
      previousLearning: currentLearning,
      responseTimeMs,
      examDate: data.settings.examDate,
      now,
      useResponseTime: data.settings.useResponseTime,
    });
    const selectedOption = currentQuestion.options.find((option) => option.id === selectedOptionId);
    const event: ReviewEvent = {
      id: stableId("event", `${currentCard.sense.id}|${now.toISOString()}|${selectedOptionId}`),
      senseId: currentCard.sense.id,
      wordId: currentCard.word.id,
      kind: "review",
      rating: result.evaluation.rating,
      confidence: result.evaluation.inferredConfidence,
      responseTimeMs,
      reason: result.learning.scheduleReason,
      note: "",
      reviewedAt: now.toISOString(),
      catalogVersion: data.catalogVersion,
      questionType: currentQuestion.kind,
      questionId: currentQuestion.id,
      selectedOptionId,
      selectedSenseId: selectedOption?.senseId,
      correctOptionId: currentQuestion.correctOptionId,
      isCorrect: result.evaluation.isCorrect,
      responseBand: result.evaluation.responseBand,
      distractorSenseIds: currentQuestion.distractorSenseIds,
    };
    let nextQueue = sessionQueue;
    if (!result.evaluation.isCorrect && !repeatedInSession.current.has(currentCard.sense.id)) {
      repeatedInSession.current.add(currentCard.sense.id);
      nextQueue = [...sessionQueue, { ...currentCard, learning: result.learning, reason: result.learning.scheduleReason, isNew: false }];
      setSessionQueue(nextQueue);
    }
    updateData((previous) => {
      const answered = {
        ...previous,
        learning: { ...previous.learning, [currentCard.sense.id]: result.learning },
        reviewEvents: [event, ...previous.reviewEvents],
      };
      if (!activeSessionId) return answered;
      return updateActiveStudySessionProgress(answered, {
        sessionId: activeSessionId,
        queueSenseIds: nextQueue.map(({ sense }) => sense.id),
        nextIndex: sessionIndex + 1,
        now,
      });
    });
    setAnswerFeedback(result.evaluation);
  };

  const advanceCard = () => {
    if (!currentCard || !answerFeedback) return;
    const nextQueue = sessionQueue;
    const nextIndex = sessionIndex + 1;
    if (nextIndex >= nextQueue.length) {
      stopPronunciation();
      setSessionComplete(true);
      setSessionQueue([]);
      setSessionIndex(0);
      setActiveSessionId(null);
      setAnswerFeedback(null);
      return;
    }
    stopPronunciation();
    setSessionIndex(nextIndex);
    setAnswerFeedback(null);
    setAudioMessage("");
    setCardStartedAt(Date.now());
  };

  const saveSenseNotes = () => {
    if (!selectedWord || !selectedSense) return;
    const relations: RelationNotes = {
      synonyms: [...new Set([...selectedSense.relations.synonyms, ...splitList(relationDraft.synonyms)])],
      antonyms: [...new Set([...selectedSense.relations.antonyms, ...splitList(relationDraft.antonyms)])],
      confusables: [...new Set([...selectedSense.relations.confusables, ...splitList(relationDraft.confusables)])],
    };
    updateData((previous) => ({
      ...previous,
      words: previous.words.map((word) =>
        word.id !== selectedWord.id
          ? word
          : {
              ...word,
              updatedAt: new Date().toISOString(),
              senses: word.senses.map((sense) =>
                sense.id === selectedSense.id ? { ...sense, relations, contextNote: relationDraft.contextNote } : sense,
              ),
            },
      ),
    }));
    setNotice("词义关系和语境笔记已保存；自填内容只作为本地补充，不会升级目录的验证状态。");
  };

  const recordMistake = () => {
    const word = data.words.find((candidate) => candidate.normalizedHeadword === mistakeHeadword.trim().toLowerCase());
    const sense = word?.senses[0];
    if (!word || !sense) {
      setNotice("请先输入词库中存在的单词。");
      return;
    }
    const now = new Date();
    const previousLearning = data.learning[sense.id] ?? createLearningState(sense, word.initialLapses, now);
    const nextLearning = {
      ...previousLearning,
      lapseCount: previousLearning.lapseCount + 1,
      nextReviewAt: now.toISOString(),
      scheduleReason: `手动记录错题：${mistakeReason}。已加入今日强化。`,
    };
    const event: ReviewEvent = {
      id: stableId("event", `${sense.id}|mistake|${now.toISOString()}`),
      senseId: sense.id,
      wordId: word.id,
      kind: "mistake",
      rating: "again",
      confidence: 1,
      responseTimeMs: 0,
      reason: mistakeReason,
      note: mistakeNote.trim(),
      reviewedAt: now.toISOString(),
      catalogVersion: data.catalogVersion,
    };
    updateData((previous) => ({
      ...previous,
      learning: { ...previous.learning, [sense.id]: nextLearning },
      reviewEvents: [event, ...previous.reviewEvents],
    }));
    setMistakeHeadword("");
    setMistakeNote("");
    setNotice("错题已记录，该词已加入今日强化队列。");
  };

  const handleMockScreenshot = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("请选择 PNG、JPG 或 WebP 截图。");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice("单张截图请控制在 8 MB 以内，以免浏览器本地存储过大。");
      return;
    }
    setMockAttachmentBusy(true);
    try {
      const localDataUrl = await fileAsDataUrl(file);
      setMockAttachment({
        id: stableId("mock-image", `${file.name}|${file.size}|${file.lastModified}`),
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        lastModifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
        localDataUrl,
      });
      setMockAttachmentCleared(false);
      setNotice("截图已读取到本机草稿；不会上传，也不会进入公开词库。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "截图读取失败。");
    } finally {
      setMockAttachmentBusy(false);
    }
  };

  const resetMockMistakeForm = () => {
    setMockForm(emptyMockMistakeForm());
    setMockAttachment(null);
    setMockAttachmentCleared(false);
    setEditingMockMistakeId(null);
  };

  const saveMockMistake = () => {
    const now = new Date();
    const existing = data.mockMistakes.find((record) => record.id === editingMockMistakeId);
    const linkedWords = splitList(mockForm.linkedHeadwords)
      .map((headword) => data.words.find((word) => word.normalizedHeadword === headword.toLowerCase()))
      .filter((word): word is WordEntry => Boolean(word));
    const linkedWordIds = [...new Set(linkedWords.map((word) => word.id))];
    const linkedSenseIds = [...new Set(linkedWords.flatMap((word) => word.senses[0]?.id ? [word.senses[0].id] : []))];
    const rawText = [mockForm.passageText, mockForm.questionText, mockForm.optionsText].filter(Boolean).join("\n");
    const draft = createMockMistakeDraftFromOcr({
      id: existing?.id,
      questionType: mockForm.questionType,
      rawText,
      questionText: mockForm.questionText,
      passageText: mockForm.passageText,
      attachment: mockAttachment ?? existing?.attachments[0],
      ocrEngine: "manual",
      source: {
        kind: "mock_test",
        label: mockForm.sourceLabel,
        mockName: mockForm.mockName,
        questionNumber: mockForm.questionNumber,
        localLocator: mockAttachment?.name ?? existing?.source.localLocator,
      },
      createdAt: existing?.createdAt ?? now,
    });
    const candidate: MockMistakeRecord = {
      ...draft,
      status: "draft",
      originalUserAnswer: mockAnswerFromText(draft.options, mockForm.userAnswer),
      correctAnswer: mockAnswerFromText(draft.options, mockForm.correctAnswer),
      errorCauses: [mockForm.errorCause],
      analysis: {
        rootCause: mockMistakeCauseLabels[mockForm.errorCause],
        correctReasoning: mockForm.correctReasoning.trim(),
        trapAnalysis: mockForm.trapAnalysis.trim(),
        improvementPlan: mockForm.improvementPlan.trim(),
        notes: existing?.analysis.notes ?? "",
      },
      linkedWordIds,
      linkedSenseIds,
      attachments: mockAttachment ? [mockAttachment] : mockAttachmentCleared ? [] : existing?.attachments ?? draft.attachments,
      createdAt: existing?.createdAt ?? draft.createdAt,
      updatedAt: now.toISOString(),
      lastReviewedAt: existing?.lastReviewedAt ?? null,
      nextReviewAt: existing?.nextReviewAt ?? now.toISOString(),
      mastery: existing?.mastery ?? 0,
      lapses: existing?.lapses ?? 1,
      reviewCount: existing?.reviewCount ?? 0,
      reviewHistory: existing?.reviewHistory ?? [],
    };
    const ready = isMockMistakeReady(candidate);
    if (existing && (existing.status === "mastered" || existing.status === "archived") && !ready) {
      setNotice(`这道${existing.status === "mastered" ? "已掌握" : "已归档"}错题的必填内容尚未补齐，原记录未被改动。`);
      return;
    }
    const preservedStatus = existing && (existing.status === "mastered" || existing.status === "archived")
      ? existing.status
      : "active";
    const saved = ready ? activateMockMistake(candidate, now, preservedStatus) : candidate;
    updateData((previous) => {
      const mockMistakes = existing
        ? previous.mockMistakes.map((record) => record.id === saved.id ? saved : record)
        : [saved, ...previous.mockMistakes];
      if (saved.status !== "active") return { ...previous, mockMistakes };
      const learning = { ...previous.learning };
      for (const senseId of saved.linkedSenseIds) {
        const found = findSense(previous, senseId);
        if (!found) continue;
        const state = learning[senseId] ?? createLearningState(found.sense, found.word.initialLapses, now);
        learning[senseId] = {
          ...state,
          nextReviewAt: now.toISOString(),
          scheduleReason: `模拟题错题关联：${saved.source.mockName || saved.source.label || "未命名练习"}，已加入词汇强化。`,
        };
      }
      return { ...previous, mockMistakes, learning };
    });
    const missingLinks = splitList(mockForm.linkedHeadwords).length - linkedWords.length;
    setNotice(saved.status === "active"
      ? `错题已补全并加入间隔复习${linkedSenseIds.length ? `，同时强化 ${linkedSenseIds.length} 个关联词` : ""}${missingLinks > 0 ? `；${missingLinks} 个关联词未在正式词库中找到` : ""}。`
      : saved.status === "mastered" || saved.status === "archived"
        ? `错题内容已更新，并保留“${saved.status === "mastered" ? "已掌握" : "已归档"}”状态。`
        : "已保存为本地草稿。补齐题目、你的答案、正确答案和正确解法后，才会进入复习。"
    );
    resetMockMistakeForm();
  };

  const editMockMistake = (record: MockMistakeRecord) => {
    const linkedHeadwords = record.linkedWordIds.flatMap((wordId) => {
      const word = data.words.find((candidate) => candidate.id === wordId);
      return word ? [word.headword] : [];
    }).join(", ");
    setMockForm({
      questionType: record.questionType,
      sourceLabel: record.source.label,
      mockName: record.source.mockName,
      questionNumber: record.source.questionNumber ?? "",
      passageText: record.passageText ?? "",
      questionText: record.questionText,
      optionsText: record.options.map((option) => `${option.label}. ${option.text}`).join("\n"),
      userAnswer: record.originalUserAnswer.text ?? record.originalUserAnswer.optionIds.join(", "),
      correctAnswer: record.correctAnswer.text ?? record.correctAnswer.optionIds.join(", "),
      errorCause: record.errorCauses[0] ?? "other",
      correctReasoning: record.analysis.correctReasoning,
      trapAnalysis: record.analysis.trapAnalysis,
      improvementPlan: record.analysis.improvementPlan,
      linkedHeadwords,
    });
    setMockAttachment(record.attachments[0] ?? null);
    setMockAttachmentCleared(false);
    setEditingMockMistakeId(record.id);
    setMistakePanel("mock");
    setNotice("已载入错题，可以继续校对和补全。");
  };

  const updateMockReviewAnswer = (recordId: string, answer: MockAnswer) => {
    setMockReviewDrafts((previous) => ({
      ...previous,
      [recordId]: { answer, submitted: false, isCorrect: null },
    }));
  };

  const submitMockMistakeAnswer = (record: MockMistakeRecord) => {
    if (!dueMockMistakeIds.has(record.id)) {
      setNotice("这道错题尚未到复习时间。");
      return;
    }
    const draft = mockReviewDrafts[record.id];
    if (!draft || (!draft.answer.optionIds.length && !draft.answer.text?.trim())) {
      setNotice("请先选择或输入本次答案。");
      return;
    }
    const now = new Date();
    try {
      const result = submitMockMistakeAttempt(record, draft.answer, now);
      updateData((previous) => ({
        ...previous,
        mockMistakes: previous.mockMistakes.map((item) => item.id === record.id ? result.record : item),
      }));
      setMockReviewDrafts((previous) => {
        const next = { ...previous };
        delete next[record.id];
        return next;
      });
      setClockNowMs(now.getTime());
      setNotice(result.wasCorrect
        ? "本次答对，判分结果已保存。请根据作答难度完成本次复习。"
        : "本次答错并已保存，系统已安排 10 分钟后重做。"
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "本次答案未能保存。");
    }
  };

  const reviewMockMistake = (record: MockMistakeRecord, outcome: MockMistakeReviewOutcome) => {
    const pending = record.pendingGradedAttempt;
    if (!pending) {
      setNotice("请先提交本次答案，由系统判分并保存后再记录难度。");
      return;
    }
    const now = new Date();
    try {
      const updated = applyMockMistakeReview(record, {
        outcome,
        answer: pending.answer,
        reviewedAt: now,
      });
      updateData((previous) => ({
        ...previous,
        mockMistakes: previous.mockMistakes.map((item) => item.id === record.id ? updated : item),
      }));
      setMockReviewDrafts((previous) => {
        const next = { ...previous };
        delete next[record.id];
        return next;
      });
      setClockNowMs(now.getTime());
      setNotice(updated.reviewHistory.at(-1)?.wasCorrect
        ? `本题掌握度已更新为 ${Math.round(updated.mastery * 100)}%。`
        : "本次答错，已安排 10 分钟后重做。"
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "本次错题复习未能保存。");
    }
  };

  const downloadSafeMistakeExport = () => {
    const exported = createSafeMockMistakeExport(data.mockMistakes, new Date());
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gre-mock-mistakes-safe-${localDateKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importOrganizedMistakes = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "records" in parsed
        ? (parsed as { records?: unknown }).records
        : parsed;
      const records = normalizeStoredMockMistakes(candidate);
      if (!records.length) throw new Error("文件里没有通过校验的错题记录。");
      updateData((previous) => {
        const merged = new Map(previous.mockMistakes.map((record) => [record.id, record]));
        for (const record of records) {
          const current = merged.get(record.id);
          if (!current || record.updatedAt >= current.updatedAt) merged.set(record.id, record);
        }
        return { ...previous, mockMistakes: [...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) };
      });
      setNotice(`已导入 ${records.length} 道整理后的错题；数据仍只保存在本机。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "错题 JSON 导入失败。");
    }
  };

  const updateSetting = (key: keyof AppData["settings"], value: string | number | boolean) => {
    if (key === "dailyNewWords") {
      const goal = normalizeDailyNewWordGoal(Number(value), data.settings.dailyNewWords);
      setDailyGoalDraft(goal);
      setAdditionalBatchSize(goal);
      setSessionComplete(false);
      updateData((previous) => ensureDailyPlan({
        ...previous,
        settings: { ...previous.settings, dailyNewWords: goal },
      }));
      return;
    }
    updateData((previous) => ({ ...previous, settings: { ...previous.settings, [key]: value } }));
  };

  const restoreBackup = async (file: File) => {
    try {
      const restored = ensureDailyPlan(await readBackup(file));
      await saveQueue.current;
      await replaceAppData(restored);
      saveQueue.current = Promise.resolve();
      stopPronunciation();
      const activeSession = loadStudyStateIntoUi(restored);
      setSelectedWordId(null);
      setSelectedSenseId(null);
      setEditingMockMistakeId(null);
      setMockForm(emptyMockMistakeForm());
      setMockAttachment(null);
      setMockAttachmentCleared(false);
      setImportPreview(null);
      setNotice(activeSession
        ? `备份恢复成功，并已恢复未完成的续学（剩余 ${activeSession.queue.length - activeSession.session.nextIndex} 题）。`
        : "备份恢复成功；旧的活动学习界面已清理。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "备份恢复失败。");
    }
  };

  const clearAllData = async () => {
    if (!window.confirm("确定清空本机的词库、复习记录和错题吗？此操作不可撤销。")) return;
    try {
      await saveQueue.current;
      const empty = await resetAppData(data.words, data.catalogVersion);
      saveQueue.current = Promise.resolve();
      stopPronunciation();
      loadStudyStateIntoUi(empty);
      setEditingMockMistakeId(null);
      setMockForm(emptyMockMistakeForm());
      setMockAttachment(null);
      setMockAttachmentCleared(false);
      setNotice("本机学习数据已清空。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "本机学习数据清空失败。");
    }
  };

  if (loading) return <div className="loading-screen">正在读取本机学习数据…</div>;
  if (startupError) return <div className="loading-screen error"><strong>数据库没有加载成功</strong><span>{startupError}</span></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark brand-icon" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
          <div><strong>GRE Verbal Lab</strong><span>你的 GRE 词汇训练室</span></div>
        </div>
        <nav aria-label="主要功能">
          {tabLabels.map((item) => {
            const NavIcon = item.icon;
            return <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => setTab(item.id)}>
              <span className="nav-icon"><NavIcon size={20} /></span><span className="nav-label">{item.label}</span>
            </button>;
          })}
        </nav>
        <div className="privacy-card"><div className="privacy-card-title"><InfoIcon size={17} /><strong>数据留在这里</strong></div><p>学习记录与错题截图只存于这台设备。</p></div>
        <div className="version">v2.2.0 alpha.2 · 私人版</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="countdown-card"><span className="top-icon"><TargetIcon size={19} /></span><div><small>距考试还有</small><strong>{examDays}<em>天</em></strong></div></div>
          <div className="top-metrics">
            <span className="top-stat"><BookOpenIcon size={17} /><span><b>{formalWords.length.toLocaleString()}</b><small>可学词</small></span></span>
            <span className="top-stat"><CheckIcon size={17} /><span><b>{learnedSenses.length.toLocaleString()}</b><small>已学习</small></span></span>
            <span className={`top-stat${dueCount ? " due" : ""}`}><ClockIcon size={17} /><span><b>{dueCount}</b><small>待复习</small></span></span>
          </div>
        </header>

        {notice && <button className="notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

        {tab === "today" && (
          <section className="page-section">
            <PageHeading
              icon={SparklesIcon}
              kicker={todayHeading.kicker}
              title={todayHeading.title}
              description={todayHeading.description}
              className={`today-heading${currentCard ? " in-session" : ""}`}
              chips={currentCard ? undefined : [
                { label: "四选一回忆", icon: CheckIcon },
                { label: "自适应复习", icon: BrainIcon },
                { label: "语境证据", icon: BookOpenIcon },
              ]}
              action={<div className="date-chip"><CalendarIcon size={15} /><span>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</span></div>}
            />
            {!data.words.length ? (
              <div className="empty-state"><div className="empty-icon">!</div><h2>默认数据库为空</h2><p>这不是正常的首次使用状态，请重新生成或恢复数据库。</p></div>
            ) : currentCard ? (
              <div className="study-layout">
                <div
                  className="study-card"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (!answerFeedback && currentQuestion && ["1", "2", "3", "4"].includes(event.key)) {
                      event.preventDefault();
                      const option = currentQuestion.options[Number(event.key) - 1];
                      if (option) answerQuestion(option.id);
                    }
                    if (answerFeedback && event.key === "Enter") { event.preventDefault(); advanceCard(); }
                  }}
                >
                  <div className="study-meta">
                    <div className="study-progress"><span><b>{sessionIndex + 1}</b> / {sessionQueue.length}</span><i><b style={{ width: `${Math.max(4, ((sessionIndex + 1) / Math.max(1, sessionQueue.length)) * 100)}%` }} /></i></div>
                    <div className="study-badges"><span className="study-badge"><BookOpenIcon size={13} />{currentCard.isNew ? "初次见面" : "再次回忆"}</span><span className={currentCard.word.frequencyProfile.tier === "focus" ? "study-badge tier focus" : "study-badge tier tail"}><TargetIcon size={13} />{currentCard.word.frequencyProfile.tier === "focus" ? "高频重点" : "低频拓展"}</span></div>
                  </div>
                  <div className="headword-line"><div className="headword">{currentCard.word.headword}</div><button className="audio-button" disabled={audioBusy} onClick={() => void speak(currentCard.word)} aria-label={`朗读 ${currentCard.word.headword}`}>{audioBusy ? "…" : <VolumeIcon size={18} />}</button></div>
                  {currentPronunciation && <div className="pronunciation-line"><span>{currentPronunciation.dialect}</span> /{currentPronunciation.ipa}/ <small>{currentPronunciation.sourceUrl ? <a href={currentPronunciation.sourceUrl} target="_blank" rel="noreferrer">{currentPronunciation.source}</a> : currentPronunciation.source}</small></div>}
                  <div className="audio-provenance">
                    {currentAudio ? <><b>真人录音 · {currentAudio.dialect} · {currentAudio.creator}</b><a href={currentAudio.sourcePageUrl} target="_blank" rel="noreferrer">{currentAudio.sourceLabel}</a><a href={currentAudio.licenseUrl} target="_blank" rel="noreferrer">{currentAudio.license}</a></> : <b className="fallback">点击后查询开放许可真人录音；无合格结果时使用系统备用音</b>}
                    <span>{([0.8, 1] as const).map((rate) => <button key={rate} className={data.settings.audioPlaybackRate === rate ? "active" : ""} onClick={() => updateSetting("audioPlaybackRate", rate)}>{rate}×</button>)}</span>
                  </div>
                  {audioMessage && <p className="audio-message">{audioMessage}</p>}
                  <div className="sense-index">词义 {currentCard.word.senses.findIndex((sense) => sense.id === currentCard.sense.id) + 1} / {currentCard.word.senses.length}</div>
                  {!currentQuestion ? <div className="quiz-error">当前词义无法生成不歧义的四个选项，已停止作答以免污染学习记录。</div> : <>
                    <div className="quiz-prompt"><span>它最接近哪一个意思？</span><small>按数字键 1–4 作答</small></div>
                    <div className="option-grid" role="radiogroup" aria-label={`${currentCard.word.headword} 的中文释义`}>
                      {currentQuestion.options.map((option, index) => {
                        const selected = answerFeedback?.selectedOptionId === option.id;
                        const correct = answerFeedback && option.id === currentQuestion.correctOptionId;
                        const wrong = Boolean(answerFeedback && selected && !correct);
                        return <button
                          key={option.id}
                          role="radio"
                          aria-checked={selected}
                          disabled={Boolean(answerFeedback)}
                          className={`quiz-option${correct ? " correct" : ""}${wrong ? " wrong" : ""}${selected ? " selected" : ""}`}
                          onClick={() => answerQuestion(option.id)}
                        ><span>{index + 1}</span><strong>{option.text}</strong>{answerFeedback && correct && <em>答案</em>}{wrong && <em>你的选择</em>}</button>;
                      })}
                    </div>
                  </>}
                  {answerFeedback && (
                    <div className="answer-area">
                      <div className={`quiz-feedback ${answerFeedback.isCorrect ? "correct" : "wrong"}`} role="status" aria-live="polite"><strong>{answerFeedback.feedbackTitle}</strong><p>{answerFeedback.feedbackDetail}</p></div>
                      <div className="definition"><span>{currentCard.sense.partOfSpeech || "词义"}</span><strong>{currentCard.sense.definitionZh}</strong>{currentCard.sense.definitionEn && <p>{currentCard.sense.definitionEn}</p>}</div>
                      {currentCard.sense.contextNote && <p className="context-note">{currentCard.sense.contextNote}</p>}
                      {(currentCard.sense.relations.synonyms.length > 0 || currentCard.sense.relations.antonyms.length > 0) && (
                        <div className="relation-chips">
                          {currentCard.sense.relations.synonyms.map((word) => <span key={`s-${word}`} className="chip synonym">≈ {word}</span>)}
                          {currentCard.sense.relations.antonyms.map((word) => <span key={`a-${word}`} className="chip antonym">↔ {word}</span>)}
                        </div>
                      )}
                      <div className="lexical-grid">
                        <div><span>同义词</span><p>{currentCard.sense.relations.synonyms.length ? currentCard.sense.relations.synonyms.join(" · ") : relationMissingLabel(currentCard.sense, "synonyms")}</p></div>
                        <div><span>反义词</span><p>{currentCard.sense.relations.antonyms.length ? currentCard.sense.relations.antonyms.join(" · ") : relationMissingLabel(currentCard.sense, "antonyms")}</p></div>
                        {currentCard.sense.relations.confusables.length > 0 && <div className="confusable-list"><span>逐义项审核易混项</span><p>{currentCard.sense.relations.confusables.join(" · ")}</p></div>}
                      </div>
                      <RelationEvidence sense={currentCard.sense} />
                      <ConfusableEvidence data={data} sense={currentCard.sense} />
                      {currentExamples.slice(0, 2).map((example) => <div className="example-panel" key={example.id}><div><span>带来源例句</span><em>{exampleKindLabel(example.kind)}</em></div><blockquote>{highlightTarget(example.text, currentCard.word.normalizedHeadword)}</blockquote>{example.translationZh && <p>{example.translationZh}</p>}<small>{example.sourceUrl ? <a href={example.sourceUrl} target="_blank" rel="noreferrer">{example.sourceLabel}</a> : example.sourceLabel} · {example.provenance}</small></div>)}
                      <GreQuestionEvidence sense={currentCard.sense} headword={currentCard.word.normalizedHeadword} compact />
                      <button className="next-card-button" onClick={advanceCard}>继续 <ChevronRightIcon size={16} /><kbd>Enter</kbd></button>
                    </div>
                  )}
                </div>
                <aside className={`reason-panel${answerFeedback ? answerFeedback.isCorrect ? " is-correct" : " is-wrong" : ""}`}>
                  <div className="reason-heading"><span className="reason-icon">{answerFeedback?.isCorrect ? <CheckIcon size={20} /> : <BrainIcon size={20} />}</span><div><span>学习反馈</span><h3>{answerFeedback ? answerFeedback.feedbackTitle : "先凭记忆选一个"}</h3></div></div>
                  <p className="reason-copy">{answerFeedback ? answerFeedback.feedbackDetail : currentCardCoachCopy}</p>
                  {!answerFeedback && <details className="reason-detail"><summary>为什么现在出现</summary><p>{currentCard.reason}</p></details>}
                  <div className="mastery-snapshot"><div className="feedback-ring" style={{ "--value": `${currentLearningState?.definitionMastery ?? 0}%` } as React.CSSProperties}><strong>{currentLearningState?.definitionMastery ?? 0}%</strong></div><div><span>记忆强度</span><small>随每次作答自动更新</small></div></div>
                  <dl>
                    <div><dt><TargetIcon size={14} />词库排序</dt><dd>#{currentCard.word.frequencyProfile.rank || "—"}</dd></div>
                    <div><dt><BookOpenIcon size={14} />题库出现</dt><dd>{currentCard.word.frequencyProfile.localMaterialCount} 次</dd></div>
                    <div><dt><HistoryIcon size={14} />遗忘记录</dt><dd>{currentLearningState?.lapseCount ?? 0}</dd></div>
                    <div><dt><ClockIcon size={14} />最近学习</dt><dd>{formatDate(currentLearningState?.lastReviewedAt ?? null)}</dd></div>
                  </dl>
                  <small className="evidence-note">掌握度根据正确率、复习历史与作答速度自动估算。</small>
                </aside>
              </div>
            ) : (
              <>
                <div className="goal-planner">
                  <div>
                    <p className="eyebrow">今日目标</p>
                    <h2>今天想认识多少个新词？</h2>
                    <p>按你的时间来。调整数量后，今日任务和预计完成日期会同步更新。</p>
                  </div>
                  <div className="goal-control">
                    <label>新词数量<input type="number" min="1" max="200" value={dailyGoalDraft} onChange={(event) => setDailyGoalDraft(Number(event.target.value))} /></label>
                    <button className="secondary-button" onClick={confirmDailyGoal}>更新今日计划</button>
                  </div>
                  <div className="goal-forecast" aria-label="学习进度预测">
                    <span><b>{studyForecast.remainingTargetCount}</b><small>待学词义</small></span>
                    <span><b>{studyForecast.studyDays}</b><small>预计学习天数</small></span>
                    <span><b>{studyForecast.studyDays ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(`${studyForecast.estimatedCompletionDate}T12:00:00`)) : "已完成"}</b><small>预计完成</small></span>
                  </div>
                </div>
                <div className="mix-summary"><span><b>{dailyPlan.focusCount}</b> 高频重点</span><i>70%</i><span><b>{dailyPlan.longTailCount}</b> 低频拓展</span><i>30%</i><small>高频打底，长尾穿插；每天都会重新打散顺序。</small></div>
                <div className="metric-grid"><article><span className="metric-label"><CheckIcon size={16} />今日任务</span><strong>{dailyQueue.length}</strong><small>{dailyQueue.filter((item) => item.isNew).length} 个新词 · {dailyQueue.filter((item) => !item.isNew).length} 个复习</small></article><article><span className="metric-label"><BookOpenIcon size={16} />可练词义</span><strong>{contentReadyWords.toLocaleString()}</strong><small>释义、发音、关系与语境均已校验</small></article><article><span className="metric-label"><ClockIcon size={16} />预计用时</span><strong>{Math.max(1, Math.ceil(dailyQueue.length * 1.1))}<em> 分钟</em></strong><small>释义与语境会在作答后展开</small></article></div>
                <div className="queue-card"><div><p className="queue-kicker"><BrainIcon size={15} />下一步</p><h2>{sessionComplete ? "这一轮，完成了" : "准备好了，就开始"}</h2><p>{sessionComplete ? `进度已保存，还有 ${extraNewWordCount} 个新词可以继续探索。` : dailyQueue[0]?.reason ?? "今天没有到期项目；你仍可继续领取新词。"}</p></div>{sessionComplete || !dailyQueue.length ? <div className="continue-control"><label>下一组<input type="number" min="1" max="200" value={additionalBatchSize} onChange={(event) => setAdditionalBatchSize(Number(event.target.value))} /><span>个</span></label><button className="primary-button" disabled={!extraNewWordCount} onClick={continueWithNewWords}>再学一组</button>{dailyQueue.length > 0 && <button className="secondary-button" onClick={startSession}>先完成复习</button>}</div> : <button className="primary-button" onClick={startSession}>开始这一轮 <ChevronRightIcon size={16} /></button>}</div>
              </>
            )}
          </section>
        )}

        {tab === "import" && (
          <section className="page-section narrow"><PageHeading icon={BookOpenIcon} kicker="本机词库" title="导入个人词库" description="如需重建个人数据库，可同时选择核心词表和补充词表；所有解析都在这台设备上完成。" />
            <label className="drop-zone"><input type="file" multiple accept=".xlsx,.csv" onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}/><span className="drop-icon">↥</span><strong>{importBusy ? "正在本机解析…" : "选择 XLSX 或 CSV 文件"}</strong><small>可以一次选择两个文件 · 原文件不会上传</small></label>
            {importMessage && <p className="inline-message">{importMessage}</p>}
            {importPreview && <div className="import-preview"><div className="preview-stats"><article><strong>{importPreview.stats.wordCount.toLocaleString()}</strong><span>唯一词条</span></article><article><strong>{importPreview.stats.senseCount.toLocaleString()}</strong><span>词义</span></article><article><strong>{importPreview.stats.enrichedWords.toLocaleString()}</strong><span>获得多义补充</span></article><article><strong>{importPreview.stats.skippedRows.toLocaleString()}</strong><span>跳过标题/空行</span></article></div><div className="source-list"><strong>识别到的文件</strong>{importPreview.stats.sourceFiles.map((file) => <span key={file}>{file}</span>)}</div><button className="primary-button" onClick={commitImport}>确认导入并生成学习计划</button></div>}
            <div className="privacy-explainer"><h3>数据如何处理</h3><p>浏览器只提取学习所需的词、词性和释义，数据写入 IndexedDB。本项目的 GitHub 仓库和备份之外不会自动发送这些内容。</p></div>
          </section>
        )}

        {tab === "library" && (
          <section className="page-section"><PageHeading icon={NetworkIcon} kicker="词义探索" title="把一个词，真正学清楚" description="查发音、辨义项、看近反义词，再回到它在 GRE 题目中的真实语境。" action={<div className="search-control"><NetworkIcon size={17} /><input className="search-box" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索单词或中文释义…" /></div>} />
            {!formalWords.length ? <div className="empty-state"><h2>目前没有通过全部校对门槛的词义</h2><p>请使用已审计的内置数据库版本。</p></div> : <div className="library-layout"><div className="word-list">{filteredWords.map((word) => { const reviewed = word.senses.filter((sense) => (data.learning[sense.id]?.reviewCount ?? 0) > 0).length; return <button key={word.id} className={selectedWord?.id === word.id ? "word-row active" : "word-row"} onClick={() => { setSelectedWordId(word.id); setSelectedSenseId(word.senses[0]?.id ?? null); }}><span><strong>{word.headword}</strong><small>{word.senses[0]?.definitionZh}</small></span><em>{reviewed}/{word.senses.length}</em></button>; })}</div>
              {selectedWord && selectedSense && <div className="word-detail"><div className="word-title"><div><p className="eyebrow">当前词条</p><div className="library-headword"><h2>{selectedWord.headword}</h2><button className="audio-button" disabled={audioBusy} onClick={() => void speak(selectedWord)} aria-label={`朗读 ${selectedWord.headword}`}><VolumeIcon size={18} /></button></div><div className="pronunciation-line">{trustedPronunciations(selectedWord).map((item) => <span key={`${item.dialect}-${item.ipa}`}>{item.dialect} /{item.ipa}/</span>)}</div>{selectedAudio && <div className="library-audio-source">真人录音 · {selectedAudio.creator} · <a href={selectedAudio.sourcePageUrl} target="_blank" rel="noreferrer">{selectedAudio.sourceLabel}</a> · <a href={selectedAudio.licenseUrl} target="_blank" rel="noreferrer">{selectedAudio.license}</a></div>}<span>{selectedWord.senses.length} 个词义 · 词库排序 #{selectedWord.frequencyProfile.rank || "—"} · 题库出现 {selectedWord.frequencyProfile.localMaterialCount} 次</span></div><div className="mastery-ring" style={{ "--value": `${data.learning[selectedSense.id]?.definitionMastery ?? 0}%` } as React.CSSProperties}><b>{data.learning[selectedSense.id]?.definitionMastery ?? 0}%</b></div></div>
                <div className="sense-tabs">{selectedWord.senses.map((sense, index) => <button key={sense.id} className={sense.id === selectedSense.id ? "active" : ""} onClick={() => setSelectedSenseId(sense.id)}>义项 {index + 1}</button>)}</div>
                <div className="definition-panel"><span>{selectedSense.partOfSpeech || "词义"}</span><strong>{selectedSense.definitionZh}</strong>{selectedSense.definitionEn && <p>{selectedSense.definitionEn}</p>}<div className="library-relations"><span>≈ {selectedSense.relations.synonyms.join(" · ") || relationMissingLabel(selectedSense, "synonyms")}</span><span>↔ {selectedSense.relations.antonyms.join(" · ") || relationMissingLabel(selectedSense, "antonyms")}</span>{selectedSense.relations.confusables.length > 0 && <span>易混：{selectedSense.relations.confusables.join(" · ")}</span>}</div><RelationEvidence sense={selectedSense} /><ConfusableEvidence data={data} sense={selectedSense} />{studyExamplesFor(selectedWord, selectedSense).map((example) => <blockquote key={example.id}>{highlightTarget(example.text, selectedWord.normalizedHeadword)}<small>{exampleKindLabel(example.kind)} · {example.sourceLabel}</small></blockquote>)}<small>{selectedSense.sourceLabel}</small></div>
                <GreQuestionEvidence sense={selectedSense} headword={selectedWord.normalizedHeadword} />
                <div className="relation-form"><label>核心近义词<input value={relationDraft.synonyms} onChange={(event) => setRelationDraft({ ...relationDraft, synonyms: event.target.value })} placeholder="例如：concise, succinct" /></label><label>反义词<input value={relationDraft.antonyms} onChange={(event) => setRelationDraft({ ...relationDraft, antonyms: event.target.value })} placeholder="例如：verbose" /></label><label>易混词<input value={relationDraft.confusables} onChange={(event) => setRelationDraft({ ...relationDraft, confusables: event.target.value })} placeholder="例如：laconic" /></label><label className="full">我的辨析笔记<textarea value={relationDraft.contextNote} onChange={(event) => setRelationDraft({ ...relationDraft, contextNote: event.target.value })} placeholder="记录它在题目中出现的句子结构、语气或易错点。" /></label><button className="secondary-button" onClick={saveSenseNotes}>保存笔记</button></div>
              </div>}
            </div>}
          </section>
        )}

        {tab === "mistakes" && (
          <section className="page-section"><PageHeading icon={HistoryIcon} kicker="错题复盘" title="把每次失误，变成下一次的把握" description="保存截图，拆解错因，再按遗忘节奏重做；所有内容都留在本机。" />
            <div className="mistake-panel-tabs" role="tablist"><button className={mistakePanel === "mock" ? "active" : ""} onClick={() => setMistakePanel("mock")}>GRE 模拟题错题 <span>{data.mockMistakes.length}</span></button><button className={mistakePanel === "vocabulary" ? "active" : ""} onClick={() => setMistakePanel("vocabulary")}>词汇错因 <span>{data.reviewEvents.filter((event) => event.kind === "mistake" || event.rating === "again" || event.rating === "hard").length}</span></button></div>
            {mistakePanel === "mock" ? <>
              <div className="metric-grid mock-metrics"><article><span>模拟题错题</span><strong>{mockMistakeStats.total}</strong><small>{mockMistakeStats.drafts} 道待补全草稿</small></article><article><span>现在到期</span><strong>{mockMistakeStats.due}</strong><small>按遗忘风险排序重做</small></article><article><span>稳定掌握</span><strong>{mockMistakeStats.mastered}</strong><small>仍会在长间隔后抽查</small></article><article><span>平均掌握度</span><strong>{Math.round(mockMistakeStats.averageMastery * 100)}%</strong><small>基于后续重做结果</small></article></div>
              <div className="mock-mistake-layout">
                <div className="mock-mistake-form">
                  <div className="mock-form-heading"><div><p className="eyebrow">收录新错题</p><h2>{editingMockMistakeId ? "继续整理这道题" : "从一张截图开始"}</h2></div>{editingMockMistakeId && <button onClick={resetMockMistakeForm}>取消编辑</button>}</div>
                  <label className="mock-shot-picker"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void handleMockScreenshot(event.target.files?.[0])} /><span>{mockAttachmentBusy ? "正在读取…" : mockAttachment ? "更换截图" : "选择错题截图"}</span><small>PNG / JPG / WebP，最多 8 MB；不会上传</small></label>
                  {mockAttachment?.localDataUrl && <div className="mock-shot-preview"><img src={mockAttachment.localDataUrl} alt="本地错题截图预览" /><button onClick={() => { setMockAttachment(null); setMockAttachmentCleared(true); }}>移除截图</button></div>}
                  <div className="mock-form-grid"><label>题型<select value={mockForm.questionType} onChange={(event) => setMockForm({ ...mockForm, questionType: event.target.value as MockQuestionType })}>{MOCK_QUESTION_TYPES.map((type) => <option key={type} value={type}>{mockQuestionTypeLabels[type]}</option>)}</select></label><label>来源 / 平台<input value={mockForm.sourceLabel} onChange={(event) => setMockForm({ ...mockForm, sourceLabel: event.target.value })} placeholder="例如：PP2 / Manhattan" /></label><label>模考名称<input value={mockForm.mockName} onChange={(event) => setMockForm({ ...mockForm, mockName: event.target.value })} placeholder="例如：PP2 Verbal Section 1" /></label><label>题号<input value={mockForm.questionNumber} onChange={(event) => setMockForm({ ...mockForm, questionNumber: event.target.value })} placeholder="例如：Q8" /></label></div>
                  {(mockForm.questionType === "RC" || mockForm.questionType === "CR") && <label>文章 / 论证原文<textarea value={mockForm.passageText} onChange={(event) => setMockForm({ ...mockForm, passageText: event.target.value })} placeholder="把截图识别后的文章贴在这里，之后可以继续校对。" /></label>}
                  <label>题干<textarea value={mockForm.questionText} onChange={(event) => setMockForm({ ...mockForm, questionText: event.target.value })} placeholder="输入或粘贴题干；截图可以先只保存为草稿。" /></label>
                  <label>选项（每行一个）<textarea value={mockForm.optionsText} onChange={(event) => setMockForm({ ...mockForm, optionsText: event.target.value })} placeholder={"A. option one\nB. option two\nC. option three"} /></label>
                  <div className="mock-form-grid answers"><label>你当时的答案<input value={mockForm.userAnswer} onChange={(event) => setMockForm({ ...mockForm, userAnswer: event.target.value })} placeholder="例如：B / taciturn" /></label><label>正确答案<input value={mockForm.correctAnswer} onChange={(event) => setMockForm({ ...mockForm, correctAnswer: event.target.value })} placeholder="例如：D / laconic" /></label></div>
                  <label>主要错因<select value={mockForm.errorCause} onChange={(event) => setMockForm({ ...mockForm, errorCause: event.target.value as MockMistakeCause })}>{MOCK_MISTAKE_CAUSES.map((cause) => <option key={cause} value={cause}>{mockMistakeCauseLabels[cause]}</option>)}</select></label>
                  <label>正确解题过程<textarea value={mockForm.correctReasoning} onChange={(event) => setMockForm({ ...mockForm, correctReasoning: event.target.value })} placeholder="写出证据、逻辑关系，以及为什么正确答案成立。补齐后才进入复习。" /></label>
                  <label>干扰项为什么错<textarea value={mockForm.trapAnalysis} onChange={(event) => setMockForm({ ...mockForm, trapAnalysis: event.target.value })} placeholder="记录你为何被吸引，以及排除它的依据。" /></label>
                  <label>下次改进动作<textarea value={mockForm.improvementPlan} onChange={(event) => setMockForm({ ...mockForm, improvementPlan: event.target.value })} placeholder="例如：先标转折词，再判断空格语气。" /></label>
                  <label>关联词汇<input list="word-options" value={mockForm.linkedHeadwords} onChange={(event) => setMockForm({ ...mockForm, linkedHeadwords: event.target.value })} placeholder="多个词用逗号分隔，例如 laconic, taciturn" /></label><datalist id="word-options">{data.words.slice(0, 5000).map((word) => <option key={word.id} value={word.headword} />)}</datalist>
                  <button className="primary-button" onClick={saveMockMistake}>{mockForm.questionText && mockForm.userAnswer && mockForm.correctAnswer && mockForm.correctReasoning ? "保存并加入复习" : "保存为本地草稿"}</button>
                  <p className="private-form-note">以后你把截图发给我，我可以帮你识别并校对这些字段；App 本身不会把截图发送给任何 OCR 服务。</p>
                </div>
                <div className="mock-mistake-feed">
                  <div className="mock-feed-heading"><div><p className="eyebrow">复习队列</p><h2>{dueMockMistakes.length ? `今天有 ${dueMockMistakes.length} 道该重做` : "你的错题档案"}</h2></div><div className="mock-feed-actions"><label className="file-button">导入整理结果<input type="file" accept="application/json,.json" onChange={(event) => void importOrganizedMistakes(event.target.files?.[0])} /></label><button className="secondary-button" disabled={!data.mockMistakes.length} onClick={downloadSafeMistakeExport}>安全导出（无截图）</button></div></div>
                  {dueMockMistakes.length > 0 && <><h3 className="mock-feed-section-title">现在到期 · 先独立重做</h3>{dueMockMistakes.map((record) => <MockMistakeCard key={record.id} record={record} isDue reviewDraft={mockReviewDrafts[record.id]} onAnswerChange={(answer) => updateMockReviewAnswer(record.id, answer)} onSubmitAnswer={() => submitMockMistakeAnswer(record)} onRate={(outcome) => reviewMockMistake(record, outcome)} onEdit={() => editMockMistake(record)} />)}</>}
                  {otherMockMistakes.length > 0 && <><h3 className="mock-feed-section-title">其他错题档案</h3>{otherMockMistakes.map((record) => <MockMistakeCard key={record.id} record={record} isDue={false} reviewDraft={undefined} onAnswerChange={() => undefined} onSubmitAnswer={() => undefined} onRate={() => undefined} onEdit={() => editMockMistake(record)} />)}</>}
                  {!data.mockMistakes.length && <div className="feed-empty">还没有模拟题错题。可以先只放一张截图保存为草稿，之后再补题干、答案和解析。</div>}
                </div>
              </div>
            </> : <div className="mistake-layout"><div className="mistake-form"><h2>快速记录词汇问题</h2><label>相关单词<input list="vocabulary-word-options" value={mistakeHeadword} onChange={(event) => setMistakeHeadword(event.target.value)} placeholder="输入词库中的单词" /></label><datalist id="vocabulary-word-options">{data.words.slice(0, 5000).map((word) => <option key={word.id} value={word.headword} />)}</datalist><label>错因<select value={mistakeReason} onChange={(event) => setMistakeReason(event.target.value)}><option>未知词义</option><option>近义词辨析错误</option><option>反义或转折判断错误</option><option>语气强度错误</option><option>正确但信心不足</option><option>时间压力</option></select></label><label>个人备注<textarea value={mistakeNote} onChange={(event) => setMistakeNote(event.target.value)} placeholder="可只写一道题的来源或一句提醒，不必复制整道题。" /></label><button className="primary-button" onClick={recordMistake}>记录并加入强化</button></div>
              <div className="mistake-feed"><h2>最近需要强化</h2>{data.reviewEvents.filter((event) => event.kind === "mistake" || event.rating === "again" || event.rating === "hard").slice(0, 30).map((event) => { const found = findSense(data, event.senseId); return <article key={event.id}><div><strong>{found?.word.headword ?? "已删除词条"}</strong><span>{found?.sense.definitionZh}</span></div><div><em>{event.kind === "mistake" ? event.reason : ratingLabels[event.rating].label}</em><small>{formatDate(event.reviewedAt)}</small></div>{event.note && <p>{event.note}</p>}</article>; })}{!data.reviewEvents.some((event) => event.kind === "mistake" || event.rating === "again" || event.rating === "hard") && <div className="feed-empty">还没有词汇错因记录。作答错误或手动记录后，这里会出现需要强化的词。</div>}</div>
            </div>}
          </section>
        )}

        {tab === "progress" && <ProgressView data={data} dueCount={dueCount} masteryAverage={masteryAverage} />}

        {tab === "settings" && (
          <section className="page-section narrow"><PageHeading icon={SettingsIcon} kicker="学习偏好" title="把学习节奏调成适合你的样子" description="考试日期、每日目标、发音和备份，都可以随时调整。" />
            <div className="catalog-card"><div><span>词库版本</span><strong>{data.catalogVersion}</strong></div><div><span>词库总词条</span><strong>{data.words.length.toLocaleString()}</strong></div><div><span>可学词 / 词义</span><strong>{formalWords.length.toLocaleString()} / {formalSenseCount.toLocaleString()}</strong></div><div><span>真人发音</span><strong>{humanAudioWords.toLocaleString()}</strong></div><div><span>可练词义</span><strong>{contentReadyWords.toLocaleString()}</strong></div><div><span>新词组合</span><strong>70% 高频 + 30% 拓展</strong></div></div>
            <div className="settings-grid"><label>目标考试日期<input type="date" value={data.settings.examDate} onChange={(event) => updateSetting("examDate", event.target.value)} /></label><label>每日新词目标<input type="number" min="1" max="200" value={data.settings.dailyNewWords} onChange={(event) => updateSetting("dailyNewWords", Number(event.target.value))} /></label><label>每日复习上限<input type="number" min="10" max="300" value={data.settings.dailyReviewLimit} onChange={(event) => updateSetting("dailyReviewLimit", Number(event.target.value))} /></label><label>发音速度<select value={data.settings.audioPlaybackRate} onChange={(event) => updateSetting("audioPlaybackRate", Number(event.target.value))}><option value={0.8}>0.8× 慢速</option><option value={1}>1× 原速</option></select></label><label className="checkbox-setting"><input type="checkbox" checked={data.settings.useResponseTime} onChange={(event) => updateSetting("useResponseTime", event.target.checked)} /><span>把作答速度计入掌握度<small>关闭后只根据正确率与复习历史判断</small></span></label></div>
            <div className="backup-card"><div><h2>本机备份</h2><p>导出内容包括词库、词义关系、复习记录、错题和设置。</p></div><div className="button-row"><button className="secondary-button" onClick={() => downloadBackup(data)}>导出备份</button><label className="file-button">从备份恢复<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); }} /></label></div></div>
            <details className="advanced-data"><summary>词库与数据工具</summary><p>默认使用内置数据库。只有开发新词库或迁移个人材料时，才需要手动导入 XLSX/CSV。</p><button className="secondary-button" onClick={() => setTab("import")}>打开手动导入工具</button></details>
            <div className="danger-zone"><div><h3>清除个人学习数据</h3><p>保留默认词汇数据库，只删除这个浏览器中的掌握度、错题和复习历史。</p></div><button onClick={() => void clearAllData()}>清除学习数据</button></div>
          </section>
        )}
      </main>
    </div>
  );
}

function ProgressView({ data, dueCount, masteryAverage }: { data: AppData; dueCount: number; masteryAverage: number }) {
  const learned = Object.values(data.learning).filter((state) => state.reviewCount > 0);
  const lastSevenDays = Date.now() - 7 * 86_400_000;
  const recent = data.reviewEvents.filter((event) => new Date(event.reviewedAt).getTime() >= lastSevenDays);
  const ratings = (["again", "hard", "good", "easy"] as Rating[]).map((rating) => ({ rating, count: recent.filter((event) => event.rating === rating).length }));
  const max = Math.max(1, ...ratings.map((item) => item.count));
  const mature = learned.filter((state) => state.definitionMastery >= 70).length;
  return <section className="page-section"><PageHeading icon={ProgressIcon} kicker="学习轨迹" title="看见积累，也看见下一步" description="每一次回忆都按词义记录；见过，不等于真正掌握。" /><div className="metric-grid progress"><article><span className="metric-label"><BookOpenIcon size={16} />已开始</span><strong>{learned.length.toLocaleString()}</strong><small>总计 {Object.keys(data.learning).length.toLocaleString()}</small></article><article><span className="metric-label"><CheckIcon size={16} />已掌握</span><strong>{mature.toLocaleString()}</strong><small>掌握度 ≥ 70%</small></article><article><span className="metric-label"><ClockIcon size={16} />待复习</span><strong>{dueCount}</strong><small>建议今天完成</small></article><article><span className="metric-label"><BrainIcon size={16} />平均掌握度</span><strong>{masteryAverage}%</strong><small>定义回忆维度</small></article></div><div className="progress-panels"><div className="chart-card"><h2>近 7 天的回忆表现</h2>{ratings.map((item) => <div className="bar-row" key={item.rating}><span>{ratingLabels[item.rating].label}</span><div><i className={item.rating} style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} /></div><b>{item.count}</b></div>)}</div><div className="insight-card"><p className="eyebrow">下一步</p><h2>{dueCount ? `先复习 ${dueCount} 个到期词义` : "今天从新词开始"}</h2><p>{recent.length ? `近 7 天完成 ${recent.length} 次回忆；易忘与低信心词会更早出现。` : "开始第一轮后，这里会逐渐长出你的记忆曲线。"}</p></div></div></section>;
}

export default App;
