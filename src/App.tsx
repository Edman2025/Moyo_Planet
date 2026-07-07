import {
  Apple,
  Bath,
  Bed,
  BriefcaseBusiness,
  Building2,
  Car,
  Check,
  ChevronRight,
  CircleDollarSign,
  Coffee,
  Droplets,
  GraduationCap,
  Gift,
  HeartPulse,
  Home,
  Hospital,
  LogOut,
  Map,
  MessageCircle,
  Palette,
  ParkingCircle,
  Pill,
  Plus,
  RefreshCw,
  School,
  Send,
  ShoppingBag,
  Sparkles,
  Sprout,
  Star,
  Store,
  ToyBrick,
  Trophy,
  Upload,
  Users,
  UserPlus,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const apiUrl = (path: string) => `${apiBaseUrl}${path}`
const assetUrl = (path?: string) => {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path
  return `${apiBaseUrl}${path}`
}
const FIRST_PET_GEM_COST = 10
const PET_BLIND_BOX_COIN_COST = 360

type Tab = 'home' | 'create' | 'work' | 'shop' | 'city' | 'social' | 'tasks'
type PetStateKey =
  | 'hunger'
  | 'thirst'
  | 'sleep'
  | 'health'
  | 'mood'
  | 'energy'
  | 'clean'
  | 'social'

type PetStates = Record<PetStateKey, number>

type PetAttrs = {
  intelligence: number
  strength: number
  charm: number
  skill: number
  wealthLevel: number
}

type SkillKey = 'programming' | 'business' | 'communication'

type Education = {
  grade: number
  credits: number
  skills: Record<SkillKey, number>
}

type UserProfile = {
  nickname: string
  userCode: string
  createdAt: string
}

type Friend = {
  id: string
  name: string
  userCode?: string
  addedAt: string
  crop: {
    id: string
    name: string
    reward: number
    ready: boolean
  }
}

type Item = {
  id: string
  name: string
  type: 'food' | 'drink' | 'medicine' | 'toy' | 'clothes' | 'furniture'
  priceCoin?: number
  priceGem?: number
  effect: Partial<PetStates & PetAttrs>
  tone: string
}

type Job = {
  id: string
  name: string
  venue: string
  duration: number
  energyCost: number
  rewardCoin: number
  rewardExp: number
  attr: keyof PetAttrs
  minAttr: number
  minGrade?: number
  minSkills?: Partial<Record<SkillKey, number>>
}

type Course = {
  id: string
  name: string
  duration: number
  coinCost: number
  energyCost: number
  attrGain?: Partial<PetAttrs>
  gradeGain?: number
  creditGain: number
  skillGain?: Partial<Record<SkillKey, number>>
  minGrade?: number
  minSkills?: Partial<Record<SkillKey, number>>
}

type AppState = {
  profile?: UserProfile
  petName: string
  petStyle: string
  generated: boolean
  uploadedFileName?: string
  uploadedPreviewUrl?: string
  generatedPetUrl?: string
  level: number
  exp: number
  coins: number
  gems: number
  states: PetStates
  attrs: PetAttrs
  education: Education
  inventory: Record<string, number>
  completedTasks: string[]
  claimedTasks: string[]
  stolenCrops: string[]
  friends: Friend[]
  friendsAdded: string[]
  giftsSent: string[]
  parkedSlot?: string
  parkedAt?: number
  parkingSlots?: Record<string, { occupied: boolean; occupiedByMe?: boolean; occupiedByName?: string }>
  runningCare?: RunningCare
  runningJob?: RunningJob
  chat: string[]
}

type CareKind = 'feed' | 'drink' | 'sleep' | 'heal' | 'study' | 'play' | 'bath'

type RunningCare = {
  kind: CareKind
  endsAt: number
}

type RunningJob = {
  jobId: string
  endsAt: number
}

type AuthPayload = {
  token: string
  profile: UserProfile
  state: AppState
}

const SESSION_KEY = 'moyo-planet-token'
const MAX_PASSWORD_LENGTH = 128

const initialState: AppState = {
  profile: undefined,
  petName: '萌友',
  petStyle: '潮玩',
  generated: false,
  uploadedFileName: undefined,
  uploadedPreviewUrl: undefined,
  generatedPetUrl: undefined,
  level: 1,
  exp: 40,
  coins: 1280,
  gems: 80,
  states: {
    hunger: 68,
    thirst: 72,
    sleep: 64,
    health: 82,
    mood: 76,
    energy: 78,
    clean: 70,
    social: 55,
  },
  attrs: {
    intelligence: 18,
    strength: 12,
    charm: 20,
    skill: 8,
    wealthLevel: 1,
  },
  education: {
    grade: 1,
    credits: 0,
    skills: {
      programming: 0,
      business: 0,
      communication: 0,
    },
  },
  inventory: {
    riceball: 2,
    water: 2,
    plush: 1,
  },
  completedTasks: [],
  claimedTasks: [],
  stolenCrops: [],
  friends: [],
  friendsAdded: [],
  giftsSent: [],
  runningCare: undefined,
  runningJob: undefined,
  chat: [],
}

const stateMeta: Record<PetStateKey, { label: string; color: string }> = {
  hunger: { label: '饱腹', color: '#ff9f43' },
  thirst: { label: '水分', color: '#2ec4b6' },
  sleep: { label: '睡眠', color: '#7b68ee' },
  health: { label: '健康', color: '#6bcb77' },
  mood: { label: '心情', color: '#ff6b6b' },
  energy: { label: '精力', color: '#f9c74f' },
  clean: { label: '清洁', color: '#4dabf7' },
  social: { label: '社交', color: '#b197fc' },
}

const styles = ['萌系', '潮玩', '像素', '国潮', '未来']

const careDefs: Record<CareKind, { label: string; duration: number }> = {
  feed: { label: '喂食', duration: 20 },
  drink: { label: '喝水', duration: 12 },
  sleep: { label: '睡觉', duration: 120 },
  heal: { label: '看病', duration: 90 },
  study: { label: '学习', duration: 60 },
  play: { label: '娱乐', duration: 45 },
  bath: { label: '洗澡', duration: 50 },
}

const items: Item[] = [
  { id: 'riceball', name: '普通饭团', type: 'food', priceCoin: 30, effect: { hunger: 20 }, tone: '#ffb703' },
  { id: 'bento', name: '营养便当', type: 'food', priceCoin: 90, effect: { hunger: 45, health: 3 }, tone: '#fb8500' },
  { id: 'water', name: '矿泉水', type: 'drink', priceCoin: 20, effect: { thirst: 25 }, tone: '#2ec4b6' },
  { id: 'energy', name: '活力饮料', type: 'drink', priceCoin: 120, effect: { thirst: 20, energy: 20 }, tone: '#00b4d8' },
  { id: 'pill', name: '小药丸', type: 'medicine', priceCoin: 150, effect: { health: 25 }, tone: '#ef476f' },
  { id: 'plush', name: '毛绒玩具', type: 'toy', priceCoin: 180, effect: { mood: 30, social: 8 }, tone: '#ff6b6b' },
  { id: 'jacket', name: '街区外套', type: 'clothes', priceCoin: 800, effect: { charm: 5 }, tone: '#6c63ff' },
  { id: 'lamp', name: '星球台灯', type: 'furniture', priceGem: 36, effect: { mood: 10, clean: 8 }, tone: '#8ac926' },
]

const jobs: Job[] = [
  {
    id: 'coffee',
    name: '咖啡店帮工',
    venue: '街角咖啡馆',
    duration: 20,
    energyCost: 10,
    rewardCoin: 80,
    rewardExp: 20,
    attr: 'charm',
    minAttr: 0,
  },
  {
    id: 'runner',
    name: '外卖跑腿',
    venue: '城市商圈',
    duration: 35,
    energyCost: 18,
    rewardCoin: 150,
    rewardExp: 35,
    attr: 'strength',
    minAttr: 10,
    minGrade: 2,
  },
  {
    id: 'office',
    name: '办公室临时工',
    venue: '共享办公室',
    duration: 55,
    energyCost: 25,
    rewardCoin: 320,
    rewardExp: 70,
    attr: 'intelligence',
    minAttr: 18,
    minGrade: 6,
  },
  {
    id: 'creator',
    name: '内容创作',
    venue: '城市直播间',
    duration: 80,
    energyCost: 30,
    rewardCoin: 650,
    rewardExp: 130,
    attr: 'charm',
    minAttr: 25,
    minGrade: 9,
    minSkills: { communication: 2 },
  },
  {
    id: 'ai-trainer',
    name: 'AI 训练师',
    venue: '未来实验室',
    duration: 90,
    energyCost: 36,
    rewardCoin: 1_200,
    rewardExp: 220,
    attr: 'skill',
    minAttr: 24,
    minGrade: 14,
    minSkills: { programming: 3 },
  },
  {
    id: 'business-consultant',
    name: '商业顾问',
    venue: '城市会客厅',
    duration: 120,
    energyCost: 44,
    rewardCoin: 2_200,
    rewardExp: 360,
    attr: 'wealthLevel',
    minAttr: 2,
    minGrade: 15,
    minSkills: { business: 4, communication: 3 },
  },
]

const courses: Course[] = [
  {
    id: 'school-grade',
    name: '文化课升级',
    duration: 6,
    coinCost: 80,
    energyCost: 8,
    gradeGain: 1,
    creditGain: 18,
    attrGain: { intelligence: 2 },
  },
  {
    id: 'communication',
    name: '沟通训练',
    duration: 8,
    coinCost: 120,
    energyCost: 10,
    creditGain: 16,
    skillGain: { communication: 1 },
    attrGain: { charm: 3 },
  },
  {
    id: 'programming',
    name: '编程技能',
    duration: 12,
    coinCost: 240,
    energyCost: 14,
    creditGain: 24,
    skillGain: { programming: 1 },
    attrGain: { skill: 4, intelligence: 2 },
    minGrade: 7,
  },
  {
    id: 'business',
    name: '商业管理',
    duration: 16,
    coinCost: 360,
    energyCost: 18,
    creditGain: 30,
    skillGain: { business: 1 },
    attrGain: { wealthLevel: 1, charm: 2 },
    minGrade: 10,
  },
]

const venues = [
  { id: 'cafe', name: '咖啡馆', icon: Coffee, event: '进入后完成城市探索' },
  { id: 'park', name: '公园', icon: Sprout, event: '适合聊天和拜访好友' },
  { id: 'school', name: '学校', icon: School, event: '学习课程在工作页完成' },
  { id: 'office', name: '办公室', icon: Building2, event: '高薪工作在工作页解锁' },
  { id: 'hospital', name: '医院', icon: Hospital, event: '健康护理可在首页看病' },
  { id: 'mall', name: '商场', icon: Store, event: '商品购买在商店页完成' },
  { id: 'farm', name: '农场', icon: Sprout, event: '好友农场在社交页收获' },
  { id: 'parking', name: '停车场', icon: ParkingCircle, event: '共享车位在社交页停车' },
]

const slots = [
  { id: 'a1', name: '好友车位 A1', rate: 60 },
  { id: 'b2', name: '商场热区 B2', rate: 72 },
  { id: 'c3', name: '公园路边 C3', rate: 45 },
]

const taskDefs = [
  { id: 'feed', title: '完成一次喂食', reward: 80 },
  { id: 'drink', title: '给宠物补水', reward: 60 },
  { id: 'work', title: '完成一份工作', reward: 160 },
  { id: 'shop', title: '购买任意商品', reward: 120 },
  { id: 'city', title: '进入城市场景', reward: 100 },
  { id: 'social', title: '拜访好友或互动', reward: 140 },
]

const skillLabels: Record<SkillKey, string> = {
  programming: '编程',
  business: '商业',
  communication: '沟通',
}

const getDegree = (grade: number) => {
  if (grade >= 16) return '博士'
  if (grade >= 15) return '硕士'
  if (grade >= 14) return '本科'
  if (grade >= 13) return '大专'
  if (grade >= 10) return '高中'
  if (grade >= 7) return '初中'
  return '小学'
}

const formatGrade = (grade: number) => `${getDegree(grade)} · ${Math.min(16, grade)} 年级`

const degreeMilestones = [
  { grade: 7, label: '初中' },
  { grade: 10, label: '高中' },
  { grade: 13, label: '大专' },
  { grade: 14, label: '本科' },
  { grade: 15, label: '硕士' },
  { grade: 16, label: '博士' },
]

const getNextDegreeMilestone = (grade: number) => degreeMilestones.find((milestone) => grade < milestone.grade)

const meetsSkills = (education: Education, minSkills?: Partial<Record<SkillKey, number>>) =>
  Object.entries(minSkills ?? {}).every(([key, value]) => education.skills[key as SkillKey] >= (value ?? 0))

const formatSkillRequirements = (minSkills?: Partial<Record<SkillKey, number>>) =>
  Object.entries(minSkills ?? {})
    .map(([key, value]) => `${skillLabels[key as SkillKey]} Lv.${value}`)
    .join(' / ')

const normalizeState = (state: AppState): AppState => ({
  ...initialState,
  ...state,
  uploadedFileName:
    state.uploadedPreviewUrl && !state.uploadedPreviewUrl.startsWith('blob:') ? state.uploadedFileName : undefined,
  uploadedPreviewUrl: state.uploadedPreviewUrl?.startsWith('blob:') ? undefined : state.uploadedPreviewUrl,
  generatedPetUrl: /^\/generated-pets\/[a-f0-9]{32}\.(svg|png|jpg|jpeg|webp)$/.test(state.generatedPetUrl ?? '') ? state.generatedPetUrl : undefined,
  states: { ...initialState.states, ...state.states },
  attrs: { ...initialState.attrs, ...state.attrs },
  education: {
    ...initialState.education,
    ...(state.education ?? {}),
    skills: {
      ...initialState.education.skills,
      ...(state.education?.skills ?? {}),
    },
  },
  inventory: { ...initialState.inventory, ...state.inventory },
  completedTasks: state.completedTasks ?? [],
  claimedTasks: state.claimedTasks ?? [],
  stolenCrops: state.stolenCrops ?? [],
  friends: state.friends ?? [],
  friendsAdded: state.friendsAdded ?? [],
  giftsSent: state.giftsSent ?? [],
  parkingSlots: state.parkingSlots ?? initialState.parkingSlots,
  runningCare: state.runningCare,
  runningJob: state.runningJob,
  chat: state.chat ?? initialState.chat,
})

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds)
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请稍后重试')

const apiRequest = async <T,>(path: string, options: RequestInit = {}, token?: string) => {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json()
  if (!response.ok) throw new ApiError(payload.error ?? '请求失败，请稍后重试', response.status)
  return payload as T
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [state, setState] = useState<AppState>(initialState)
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem(SESSION_KEY) ?? '')
  const [authChecked, setAuthChecked] = useState(false)
  const [toast, setToast] = useState('正在连接萌友星球')
  const [now, setNow] = useState(Date.now())
  const [selectedVenue, setSelectedVenue] = useState(venues[1])
  const [message, setMessage] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isAuthLoading, setIsAuthLoading] = useState(false)
  const [settlingJobId, setSettlingJobId] = useState('')
  const [settlingCareKind, setSettlingCareKind] = useState('')

  const handleRequestError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      localStorage.removeItem(SESSION_KEY)
      setSessionToken('')
      setState(initialState)
      setTab('home')
    }
    setToast(getErrorMessage(error))
  }, [])

  useEffect(() => {
    if (!sessionToken) {
      setAuthChecked(true)
      setToast('创建账号或登录后开始游戏')
      return
    }
    let cancelled = false
    apiRequest<AuthPayload>('/api/session', { method: 'GET' }, sessionToken)
      .then((payload) => {
        if (cancelled) return
        setState(normalizeState(payload.state))
        setToast(`欢迎回到萌友星球，${payload.profile.nickname}`)
        setAuthChecked(true)
      })
      .catch((error) => {
        if (cancelled) return
        localStorage.removeItem(SESSION_KEY)
        setSessionToken('')
        setState(initialState)
        setToast(getErrorMessage(error))
        setAuthChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [sessionToken])

  useEffect(() => {
    if (!authChecked || !sessionToken || !state.profile) return
    const timer = window.setTimeout(() => {
      apiRequest<{ ok: boolean }>('/api/state', {
        method: 'PUT',
        body: JSON.stringify({ state }),
      }, sessionToken).catch(handleRequestError)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [authChecked, handleRequestError, sessionToken, state])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const expNeed = state.level * 160
  const expPercent = Math.min(100, Math.round((state.exp / expNeed) * 100))
  const currentJob = state.runningJob ? jobs.find((job) => job.id === state.runningJob?.jobId) : undefined
  const remaining = state.runningJob ? Math.ceil((state.runningJob.endsAt - now) / 1000) : 0
  const currentCare = state.runningCare ? careDefs[state.runningCare.kind] : undefined
  const careRemaining = state.runningCare ? Math.ceil((state.runningCare.endsAt - now) / 1000) : 0
  const taskStatus = useMemo(
    () =>
      taskDefs.map((task) => ({
        ...task,
        done: state.completedTasks.includes(task.id),
        claimed: state.claimedTasks.includes(task.id),
      })),
    [state.claimedTasks, state.completedTasks],
  )
  const parkedSlot = state.parkedSlot ? slots.find((slot) => slot.id === state.parkedSlot) : undefined
  const parkingPending =
    parkedSlot && state.parkedAt
      ? Math.min(360, Math.floor((now - state.parkedAt) / 10000) * Math.max(1, Math.round(parkedSlot.rate / 6)))
      : 0

  const registerUser = async (nickname: string, petName: string, password: string) => {
    const cleanNickname = nickname.trim()
    const cleanPetName = petName.trim()
    if (!cleanNickname) {
      setToast('请先填写玩家昵称')
      return
    }
    if (password.length < 6) {
      setToast('密码至少 6 位')
      return
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setToast('密码不能超过 128 位')
      return
    }
    try {
      setIsAuthLoading(true)
      const payload = await apiRequest<AuthPayload>('/api/register', {
        method: 'POST',
        body: JSON.stringify({ nickname: cleanNickname, petName: cleanPetName, password }),
      })
      localStorage.setItem(SESSION_KEY, payload.token)
      setSessionToken(payload.token)
      setState(normalizeState(payload.state))
      setToast(`欢迎 ${payload.profile.nickname} 来到萌友星球`)
    } catch (error) {
      setToast(getErrorMessage(error))
    } finally {
      setIsAuthLoading(false)
    }
  }

  const loginUser = async (userCode: string, password: string) => {
    if (!userCode.trim() || !password) {
      setToast('请输入邀请码和密码')
      return
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setToast('密码不能超过 128 位')
      return
    }
    try {
      setIsAuthLoading(true)
      const payload = await apiRequest<AuthPayload>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ userCode: userCode.trim(), password }),
      })
      localStorage.setItem(SESSION_KEY, payload.token)
      setSessionToken(payload.token)
      setState(normalizeState(payload.state))
      setToast(`欢迎回来，${payload.profile.nickname}`)
    } catch (error) {
      setToast(getErrorMessage(error))
    } finally {
      setIsAuthLoading(false)
    }
  }

  const logoutUser = async () => {
    try {
      if (sessionToken) await apiRequest<{ ok: boolean }>('/api/logout', { method: 'POST' }, sessionToken)
    } catch {
      // Local logout should still succeed when the session already expired.
    }
    localStorage.removeItem(SESSION_KEY)
    setSessionToken('')
    setState(initialState)
    setTab('home')
    setToast('已退出登录')
  }

  const runServerAction = useCallback(async (action: string, payload: Record<string, unknown>) => {
    if (!sessionToken) {
      setToast('请先登录')
      return undefined
    }
    try {
      const result = await apiRequest<{ ok: boolean; state: AppState; message: string }>('/api/action', {
        method: 'POST',
        body: JSON.stringify({ action, payload }),
      }, sessionToken)
      setState(normalizeState(result.state))
      setToast(result.message)
      return result.state
    } catch (error) {
      handleRequestError(error)
      return undefined
    }
  }, [handleRequestError, sessionToken])

  useEffect(() => {
    if (!state.runningJob || now < state.runningJob.endsAt || settlingJobId === state.runningJob.jobId) return
    setSettlingJobId(state.runningJob.jobId)
    void runServerAction('completeJob', {}).finally(() => setSettlingJobId(''))
  }, [now, state.runningJob, settlingJobId, runServerAction])

  useEffect(() => {
    if (!state.runningCare || now < state.runningCare.endsAt || settlingCareKind === state.runningCare.kind) return
    setSettlingCareKind(state.runningCare.kind)
    void runServerAction('completeCare', {}).finally(() => setSettlingCareKind(''))
  }, [now, state.runningCare, settlingCareKind, runServerAction])

  const resetProgress = () => {
    const confirmed = window.confirm('确认重置游戏进度？金币、学历、任务、工作、停车和已上传照片都会恢复初始状态，玩家账号会保留。')
    if (!confirmed) {
      setToast('已取消重置')
      return
    }
    void runServerAction('resetProgress', {}).then((nextState) => {
      if (nextState) setTab('home')
    })
  }

  const applyAction = (kind?: CareKind) => {
    if (state.runningCare) {
      setToast('已经有日常行动在进行')
      return
    }
    void runServerAction('care', { kind })
  }

  const buyItem = (item: Item) => {
    void runServerAction('buyItem', { itemId: item.id })
  }

  const useItem = (item: Item) => {
    void runServerAction('useItem', { itemId: item.id })
  }

  const startJob = (job: Job) => {
    if (state.runningJob) {
      setToast('已经有工作在进行')
      return
    }
    if (state.states.health < 30 || state.states.energy < job.energyCost) {
      setToast('状态不足，先休息或治疗')
      return
    }
    if (state.attrs[job.attr] < job.minAttr) {
      setToast('属性还不够，先学习提升')
      return
    }
    if ((job.minGrade ?? 1) > state.education.grade) {
      setToast(`学历不足，需要 ${formatGrade(job.minGrade ?? 1)}`)
      return
    }
    if (!meetsSkills(state.education, job.minSkills)) {
      setToast(`技能不足，需要 ${formatSkillRequirements(job.minSkills)}`)
      return
    }
    void runServerAction('startJob', { jobId: job.id })
  }

  const studyCourse = (course: Course) => {
    void runServerAction('studyCourse', { courseId: course.id })
  }

  const generatePet = async () => {
    if (isGenerating) return
    setIsGenerating(true)
    setToast(state.uploadedFileName ? `正在用 MiniMax 生成 ${state.uploadedFileName}，完成后自动回到首页` : '正在孵化默认数字宠物，完成后自动回到首页')
    try {
      const nextState = await runServerAction('generatePet', {})
      if (nextState) {
        setToast('生成完成，正在前往首页展示')
        setTab('home')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const uploadPhoto = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setToast('请选择图片文件')
      return
    }
    if (!sessionToken) {
      setToast('请先登录后再上传照片')
      return
    }
    try {
      setIsUploading(true)
      setToast(`正在上传 ${file.name}`)
      const dataUrl = await readFileAsDataUrl(file)
      const payload = await apiRequest<{ fileName: string; url: string; state: AppState }>('/api/upload', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          dataUrl,
        }),
      }, sessionToken)
      setState(normalizeState(payload.state))
      setToast(`照片上传成功：${payload.fileName}`)
    } catch (error) {
      handleRequestError(error)
    } finally {
      setIsUploading(false)
    }
  }

  const stealCrop = (friendId: string) => {
    void runServerAction('stealCrop', { friendId })
  }

  const parkCar = (slotId: string) => {
    void runServerAction('parkCar', { slotId })
  }

  const claimParking = () => {
    void runServerAction('claimParking', {})
  }

  const addFriend = async (name: string) => {
    if (!name.trim()) {
      setToast('请输入好友邀请码')
      return false
    }
    const nextState = await runServerAction('addFriend', { name })
    return Boolean(nextState)
  }

  const sendGift = (name: string) => {
    void runServerAction('sendGift', { name })
  }

  const visitVenue = (venue: (typeof venues)[number]) => {
    setSelectedVenue(venue)
    setTab('city')
    void runServerAction('visitVenue', { venueName: venue.name })
  }

  const sendMessage = () => {
    if (!message.trim()) return
    void runServerAction('sendMessage', { message }).then((nextState) => {
      if (nextState) setMessage('')
    })
  }

  const claimTask = (taskId: string, _reward: number) => {
    void runServerAction('claimTask', { taskId })
  }

  if (!authChecked) {
    return (
      <main className="app-shell">
        <section className="auth-panel">
          <div className="auth-mark">
            <Sparkles size={28} />
          </div>
          <div>
            <p className="brand">萌友星球</p>
            <h1>正在连接</h1>
          </div>
        </section>
        <section className="toast" role="status">
          {toast}
        </section>
      </main>
    )
  }

  if (!state.profile) {
    return (
      <main className="app-shell">
        <AuthView onRegister={registerUser} onLogin={loginUser} isLoading={isAuthLoading} />
        <section className="toast" role="status">
          {toast}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">萌友星球</p>
          <h1>Moyo Planet</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" aria-label="重新开始" onClick={resetProgress}>
            <RefreshCw size={18} />
          </button>
          <button className="icon-button" type="button" aria-label="退出登录" onClick={logoutUser}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="wallet" aria-label="玩家资源">
        <div className="profile-pill">
          <Users size={17} />
          <span>{state.profile.nickname}</span>
          <small>{state.profile.userCode}</small>
        </div>
        <div>
          <CircleDollarSign size={17} />
          <span>{state.coins}</span>
        </div>
        <div>
          <Sparkles size={17} />
          <span>{state.gems}</span>
        </div>
        <div className="level-pill">
          Lv.{state.level}
          <span>{expPercent}%</span>
        </div>
      </section>

      <section className="toast" role="status">
        {toast}
      </section>

      <div className="content">
        {tab === 'home' && (
          <HomeView
            state={state}
            expNeed={expNeed}
            currentJob={currentJob}
            remaining={remaining}
            currentCare={currentCare}
            currentCareKind={state.runningCare?.kind}
            careRemaining={careRemaining}
            onAction={applyAction}
            onNavigate={setTab}
          />
        )}
        {tab === 'create' && (
          <CreateView
            state={state}
            isGenerating={isGenerating}
            isUploading={isUploading}
            onStyle={(style) => setState((current) => ({ ...current, petStyle: style }))}
            onUpload={uploadPhoto}
            onGenerate={generatePet}
          />
        )}
        {tab === 'work' && (
          <WorkView state={state} runningJob={currentJob} remaining={remaining} onStart={startJob} onStudy={studyCourse} />
        )}
        {tab === 'shop' && <ShopView state={state} onBuy={buyItem} onUse={useItem} />}
        {tab === 'city' && (
          <CityView
            state={state}
            selectedVenue={selectedVenue}
            message={message}
            onMessage={setMessage}
            onSend={sendMessage}
            onVisit={visitVenue}
          />
        )}
        {tab === 'social' && (
          <SocialView
            state={state}
            parkingPending={parkingPending}
            onSteal={stealCrop}
            onPark={parkCar}
            onClaimParking={claimParking}
            onAddFriend={addFriend}
            onSendGift={sendGift}
            onVisit={() => {
              void runServerAction('visitVenue', { venueName: '好友家园' })
            }}
          />
        )}
        {tab === 'tasks' && <TasksView tasks={taskStatus} onClaim={claimTask} />}
      </div>

      <nav className="bottom-nav" aria-label="主导航">
        {[
          { id: 'home', label: '首页', icon: Home },
          { id: 'work', label: '工作', icon: BriefcaseBusiness },
          { id: 'shop', label: '商店', icon: ShoppingBag },
          { id: 'city', label: '城市', icon: Map },
          { id: 'social', label: '社交', icon: Users },
          { id: 'tasks', label: '任务', icon: Trophy },
        ].map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              className={tab === entry.id ? 'active' : ''}
              aria-label={entry.label}
              onClick={() => setTab(entry.id as Tab)}
            >
              <Icon size={20} />
              <span>{entry.label}</span>
            </button>
          )
        })}
      </nav>
    </main>
  )
}

function AuthView({
  onRegister,
  onLogin,
  isLoading,
}: {
  onRegister: (nickname: string, petName: string, password: string) => void
  onLogin: (userCode: string, password: string) => void
  isLoading: boolean
}) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [nickname, setNickname] = useState('')
  const [petName, setPetName] = useState('萌友')
  const [userCode, setUserCode] = useState('')
  const [password, setPassword] = useState('')
  const isRegister = mode === 'register'

  return (
    <section className="auth-panel">
      <div className="auth-mark">
        <Sparkles size={28} />
      </div>
      <div>
        <p className="brand">萌友星球</p>
        <h1>{isRegister ? '创建玩家资料' : '登录玩家账号'}</h1>
      </div>
      <div className="auth-tabs">
        <button type="button" className={isRegister ? 'active' : ''} onClick={() => setMode('register')}>
          注册
        </button>
        <button type="button" className={!isRegister ? 'active' : ''} onClick={() => setMode('login')}>
          登录
        </button>
      </div>
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (isRegister) onRegister(nickname, petName, password)
          else onLogin(userCode, password)
        }}
      >
        {isRegister ? (
          <>
            <label>
              <span>玩家昵称</span>
              <input
                value={nickname}
                maxLength={16}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="输入你的昵称"
              />
            </label>
            <label>
              <span>宠物名字</span>
              <input
                value={petName}
                maxLength={16}
                onChange={(event) => setPetName(event.target.value)}
                placeholder="给宠物取名"
              />
            </label>
          </>
        ) : (
          <label>
            <span>玩家邀请码</span>
            <input
              value={userCode}
              autoCapitalize="characters"
              onChange={(event) => setUserCode(event.target.value)}
              placeholder="例如 MOYO-1A2B3C"
            />
          </label>
        )}
        <label>
          <span>密码</span>
          <input
            value={password}
            minLength={6}
            maxLength={MAX_PASSWORD_LENGTH}
            type="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 6 位"
          />
        </label>
        <button
          type="submit"
          className="primary-button"
          disabled={isLoading}
        >
          {isLoading ? '处理中...' : isRegister ? '创建并进入' : '登录并进入'}
        </button>
      </form>
    </section>
  )
}

function HomeView({
  state,
  expNeed,
  currentJob,
  remaining,
  currentCare,
  currentCareKind,
  careRemaining,
  onAction,
  onNavigate,
}: {
  state: AppState
  expNeed: number
  currentJob?: Job
  remaining: number
  currentCare?: { label: string; duration: number }
  currentCareKind?: CareKind
  careRemaining: number
  onAction: (kind?: CareKind) => void
  onNavigate: (tab: Tab) => void
}) {
  const [petTrick, setPetTrick] = useState('')
  const actions = [
    { label: '喂食', icon: Apple, patch: { hunger: 18, mood: 3 }, task: 'feed', kind: 'feed' },
    { label: '喝水', icon: Droplets, patch: { thirst: 22 }, task: 'drink', kind: 'drink' },
    { label: '睡觉', icon: Bed, patch: { sleep: 26, energy: 28, mood: 4 }, kind: 'sleep' },
    { label: '看病', icon: Pill, patch: { health: 24 }, kind: 'heal' },
    { label: '学习', icon: GraduationCap, patch: { energy: -8, mood: -2 }, kind: 'study' },
    { label: '娱乐', icon: ToyBrick, patch: { mood: 20, social: 8, energy: -5 }, kind: 'play' },
    { label: '洗澡', icon: Bath, patch: { clean: 30, mood: 4 }, kind: 'bath' },
  ]
  const baseMotion = currentJob
    ? 'run'
    : currentCareKind
      ? currentCareKind
      : state.states.health < 35
        ? 'weak'
        : state.states.sleep < 30
          ? 'sleepy'
          : state.states.mood > 75
          ? 'happy'
          : 'idle'
  const motion = !currentJob && !currentCareKind && petTrick ? petTrick : baseMotion
  const motionText = petTrick && !currentJob && !currentCareKind
    ? '互动动作'
    : currentJob
    ? '正在打工奔跑'
    : currentCare
      ? `${currentCare.label}动作中`
      : motion === 'weak'
        ? '有点虚弱'
        : motion === 'sleepy'
          ? '困困待机'
          : motion === 'happy'
            ? '开心跳跳'
            : '待机互动'
  const playPetTrick = () => {
    if (!state.generatedPetUrl || currentJob || currentCareKind) return
    const tricks = ['happy', 'play', 'run', 'study', 'bath']
    setPetTrick(tricks[Math.floor(Date.now() / 700) % tricks.length])
    window.setTimeout(() => setPetTrick(''), 1800)
  }

  return (
    <div className="screen-stack">
      <section className="pet-stage">
        <div className="pet-card">
          <div className="pet-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div
            className={`pet-avatar motion-${motion} ${state.generatedPetUrl && state.generated ? 'generated-avatar' : ''}`}
            aria-label="原创卡通宠物，点击互动"
            role={state.generatedPetUrl ? 'button' : undefined}
            tabIndex={state.generatedPetUrl ? 0 : undefined}
            onClick={playPetTrick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') playPetTrick()
            }}
          >
            {state.generatedPetUrl && state.generated ? (
              <>
                <div className="pet-sprite-frame">
                  <img className="generated-pet-image" src={assetUrl(state.generatedPetUrl)} alt={`${state.petName}的生成萌宠图片`} />
                  <span className="pet-blink" aria-hidden="true" />
                  <span className="pet-paw left" aria-hidden="true" />
                  <span className="pet-paw right" aria-hidden="true" />
                  <span className="pet-action-effect" aria-hidden="true" />
                </div>
                <span className="avatar-style">{state.petStyle}</span>
                <span className="motion-label">{motionText}</span>
              </>
            ) : (
              <>
                <div className="ear left" />
                <div className="ear right" />
                <div className="face">
                  <div className="eyes">
                    <span />
                    <span />
                  </div>
                  <div className="smile" />
                </div>
              </>
            )}
          </div>
          <div className="pet-info">
            <div>
              <p>{state.petName}</p>
              <span>
                {state.petStyle} · {state.generated ? (state.generatedPetUrl ? '动态伙伴' : '已生成') : '默认形象'}
              </span>
            </div>
            <button type="button" onClick={() => onNavigate('create')}>
              <Palette size={16} />
              生成
            </button>
          </div>
        </div>

        <div className="progress-card">
          <div className="row-between">
            <span>经验</span>
            <b>{state.exp}/{expNeed}</b>
          </div>
          <div className="progress-line">
            <span style={{ width: `${Math.min(100, (state.exp / expNeed) * 100)}%` }} />
          </div>
          {currentJob ? (
            <div className="job-chip">
              <BriefcaseBusiness size={16} />
              {currentJob.name} · {formatTime(remaining)}
            </div>
          ) : (
            <button type="button" className="wide-button" onClick={() => onNavigate('work')}>
              去工作赚钱
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </section>

      {currentCare && (
        <section className="running-banner care-banner">
          <Sparkles size={20} />
          <div>
            <b>{currentCare.label}进行中</b>
            <span>{formatTime(careRemaining)} 后完成，完成前不会结算状态</span>
          </div>
        </section>
      )}

      <section className="state-grid">
        {(Object.keys(state.states) as PetStateKey[]).map((key) => (
          <div className="state-tile" key={key}>
            <div className="row-between">
              <span>{stateMeta[key].label}</span>
              <b>{state.states[key]}</b>
            </div>
            <div className="meter">
              <span style={{ width: `${state.states[key]}%`, background: stateMeta[key].color }} />
            </div>
          </div>
        ))}
      </section>

      <section className="action-grid">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button key={action.label} type="button" disabled={Boolean(currentCare)} onClick={() => onAction(action.kind as CareKind)}>
              <Icon size={19} />
              <span>{currentCare ? '进行中' : action.label}</span>
            </button>
          )
        })}
        <button type="button" className="accent-action" onClick={() => onNavigate('tasks')}>
          <Trophy size={19} />
          <span>任务</span>
        </button>
      </section>
    </div>
  )
}

function CreateView({
  state,
  isGenerating,
  isUploading,
  onStyle,
  onUpload,
  onGenerate,
}: {
  state: AppState
  isGenerating: boolean
  isUploading: boolean
  onStyle: (style: string) => void
  onUpload: (file?: File) => void
  onGenerate: () => void
}) {
  return (
    <div className="screen-stack">
      <section className="panel create-panel">
        <Upload size={28} />
        <h2>上传照片孵化数字宠物</h2>
        <p>上传成功后会保存照片，并孵化一只 Codex 风格的动态小伙伴。</p>
        <label className={`upload-box ${isUploading ? 'is-busy' : ''}`} aria-live="polite">
          <input
            type="file"
            accept="image/*"
            disabled={isUploading || isGenerating}
            onChange={(event) => onUpload(event.target.files?.[0])}
          />
          {isUploading ? (
            <>
              <Upload size={22} />
              <strong>照片上传中</strong>
              <span>正在保存到服务端，请稍候</span>
            </>
          ) : state.uploadedPreviewUrl ? (
            <>
              <img src={assetUrl(state.uploadedPreviewUrl)} alt="已上传照片预览" />
              <strong>已上传并保存</strong>
              <span>{state.uploadedFileName}</span>
              <small>现在可以用这张照片生成宠物</small>
            </>
          ) : (
            <>
              <Plus size={22} />
              选择人物、动物或物品照片
            </>
          )}
        </label>
      </section>

      <section className="panel">
        <h3>选择风格</h3>
        <div className="segmented">
          {styles.map((style) => (
            <button
              type="button"
              key={style}
              className={state.petStyle === style ? 'active' : ''}
              disabled={isGenerating}
              onClick={() => onStyle(style)}
            >
              {style}
            </button>
          ))}
        </div>
        {isGenerating ? (
          <div className="generation-status" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <strong>AI 正在生成宠物形象</strong>
              <small>通常需要十几秒到一分钟，请不要关闭页面，完成后会自动跳到首页展示。</small>
            </div>
          </div>
        ) : null}
        {!isGenerating ? (
          <div className="blind-box-note">
            <Gift size={16} />
            <span>
              {state.generatedPetUrl
                ? `不满意可开形象盲盒重抽：消耗 ${PET_BLIND_BOX_COIN_COST} 金币，当前 ${state.coins} 金币`
                : `首次孵化消耗 ${FIRST_PET_GEM_COST} 星钻，生成后可用金币盲盒继续重抽`}
            </span>
          </div>
        ) : null}
        <button type="button" className="primary-button" onClick={onGenerate} disabled={isGenerating || isUploading}>
          {
            isUploading
              ? '照片上传中...'
              : isGenerating
                ? '生成中...'
                : state.generatedPetUrl
                  ? `金币盲盒重抽 -${PET_BLIND_BOX_COIN_COST}`
                  : state.uploadedFileName ? '用上传照片生成' : '使用默认形象生成'
          }
        </button>
      </section>
    </div>
  )
}

function WorkView({
  state,
  runningJob,
  remaining,
  onStart,
  onStudy,
}: {
  state: AppState
  runningJob?: Job
  remaining: number
  onStart: (job: Job) => void
  onStudy: (course: Course) => void
}) {
  const nextDegree = getNextDegreeMilestone(state.education.grade)
  const unlockedJobs = jobs.filter((job) => (job.minGrade ?? 1) <= state.education.grade && meetsSkills(state.education, job.minSkills))
  const nextHighPayJob = jobs
    .filter((job) => job.rewardCoin >= 650)
    .find((job) => (job.minGrade ?? 1) > state.education.grade || !meetsSkills(state.education, job.minSkills))

  return (
    <div className="screen-stack">
      {runningJob && (
        <section className="running-banner">
          <BriefcaseBusiness size={20} />
          <div>
            <b>{runningJob.name}进行中</b>
            <span>{formatTime(remaining)} 后结算奖励</span>
          </div>
        </section>
      )}

      {jobs.map((job) => {
        const educationLocked = (job.minGrade ?? 1) > state.education.grade
        const skillLocked = !meetsSkills(state.education, job.minSkills)
        const disabled =
          Boolean(runningJob) ||
          state.states.energy < job.energyCost ||
          state.attrs[job.attr] < job.minAttr ||
          educationLocked ||
          skillLocked
        return (
          <article className="work-card" key={job.id}>
            <div className="work-icon">
              <BriefcaseBusiness size={22} />
            </div>
            <div className="work-main">
              <h3>{job.name}</h3>
              <p>{job.venue} · {job.duration} 秒 · 精力 -{job.energyCost}</p>
              <div className="reward-row">
                <span>金币 +{job.rewardCoin}</span>
                <span>经验 +{job.rewardExp}</span>
                <span>{job.attr} {state.attrs[job.attr]}/{job.minAttr}</span>
                {job.minGrade ? <span>学历 {formatGrade(job.minGrade)}</span> : null}
                {job.minSkills ? <span>技能 {formatSkillRequirements(job.minSkills)}</span> : null}
              </div>
            </div>
            <button type="button" disabled={disabled} onClick={() => onStart(job)}>
              {runningJob ? (runningJob.id === job.id ? '进行中' : '等待') : disabled ? '未解锁' : '开始'}
            </button>
          </article>
        )
      })}

      <section className="panel attr-panel">
        <h3>学历与技能</h3>
        <div className="degree-card">
          <div>
            <span>当前学历</span>
            <b>{formatGrade(state.education.grade)}</b>
          </div>
          <div>
            <span>下一阶段</span>
            <b>{nextDegree ? `${nextDegree.label} · ${nextDegree.grade} 年级` : '最高学历'}</b>
          </div>
          <div>
            <span>已解锁岗位</span>
            <b>{unlockedJobs.length}/{jobs.length}</b>
          </div>
        </div>
        {nextHighPayJob ? (
          <div className="unlock-path">
            <BriefcaseBusiness size={16} />
            <span>
              下一个高薪岗位：{nextHighPayJob.name}，需要 {formatGrade(nextHighPayJob.minGrade ?? 1)}
              {nextHighPayJob.minSkills ? ` · ${formatSkillRequirements(nextHighPayJob.minSkills)}` : ''}
            </span>
          </div>
        ) : (
          <div className="unlock-path">
            <Check size={16} />
            <span>高薪岗位已全部满足学历和技能条件</span>
          </div>
        )}
        <div className="attr-grid">
          <span>年级 {state.education.grade}/16</span>
          <span>学历 {getDegree(state.education.grade)}</span>
          <span>学分 {state.education.credits}</span>
          <span>智力 {state.attrs.intelligence}</span>
          <span>体能 {state.attrs.strength}</span>
          <span>魅力 {state.attrs.charm}</span>
          <span>技能 {state.attrs.skill}</span>
          <span>编程 Lv.{state.education.skills.programming}</span>
          <span>商业 Lv.{state.education.skills.business}</span>
          <span>沟通 Lv.{state.education.skills.communication}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <GraduationCap size={19} />
          <h3>学习课程</h3>
        </div>
        <div className="course-list">
          {courses.map((course) => {
            const disabled =
              state.coins < course.coinCost ||
              state.states.energy < course.energyCost ||
              (course.minGrade ?? 1) > state.education.grade ||
              !meetsSkills(state.education, course.minSkills)
            return (
              <button type="button" key={course.id} disabled={disabled} onClick={() => onStudy(course)}>
                <GraduationCap size={18} />
                <span>
                  {course.name}
                  <small>
                    {course.duration} 秒 · 金币 -{course.coinCost} · 精力 -{course.energyCost}
                    {course.minGrade ? ` · 需${formatGrade(course.minGrade)}` : ''}
                  </small>
                </span>
                <b>
                  {course.gradeGain ? `年级 +${course.gradeGain}` : ''}
                  {course.skillGain ? ` ${formatSkillRequirements(course.skillGain)}` : ''}
                </b>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function ShopView({
  state,
  onBuy,
  onUse,
}: {
  state: AppState
  onBuy: (item: Item) => void
  onUse: (item: Item) => void
}) {
  return (
    <div className="shop-grid">
      {items.map((item) => (
        <article className="shop-card" key={item.id}>
          <div className="item-icon" style={{ background: item.tone }}>
            {item.type === 'medicine' ? <HeartPulse size={20} /> : <ShoppingBag size={20} />}
          </div>
          <h3>{item.name}</h3>
          <p>{Object.entries(item.effect).map(([key, value]) => `${key}+${value}`).join(' · ')}</p>
          <div className="row-between">
            <b>{item.priceCoin ? `${item.priceCoin}金币` : `${item.priceGem}钻石`}</b>
            <span>持有 {state.inventory[item.id] ?? 0}</span>
          </div>
          <div className="dual-actions">
            <button type="button" onClick={() => onBuy(item)}>购买</button>
            <button type="button" onClick={() => onUse(item)}>使用</button>
          </div>
        </article>
      ))}
    </div>
  )
}

function CityView({
  state,
  selectedVenue,
  message,
  onMessage,
  onSend,
  onVisit,
}: {
  state: AppState
  selectedVenue: (typeof venues)[number]
  message: string
  onMessage: (value: string) => void
  onSend: () => void
  onVisit: (venue: (typeof venues)[number]) => void
}) {
  return (
    <div className="screen-stack">
      <section className="map-board">
        {venues.map((venue, index) => {
          const Icon = venue.icon
          return (
            <button
              type="button"
              key={venue.id}
              className={`venue-dot dot-${index + 1} ${selectedVenue.id === venue.id ? 'active' : ''}`}
              onClick={() => onVisit(venue)}
              aria-label={`进入${venue.name}`}
            >
              <Icon size={17} />
              <span>{venue.name}</span>
            </button>
          )
        })}
      </section>

      <section className="panel venue-panel">
        <div className="row-between">
          <div>
            <h2>{selectedVenue.name}</h2>
            <p>{selectedVenue.event} · 公共城市频道</p>
          </div>
          <MessageCircle size={22} />
        </div>
        <div className="chat-list">
          {state.chat.length ? (
            state.chat.slice(-5).map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))
          ) : (
            <p className="empty-state">暂无消息，发第一条附近动态</p>
          )}
        </div>
        <div className="chat-input">
          <input value={message} onChange={(event) => onMessage(event.target.value)} placeholder="和附近玩家打个招呼" />
          <button type="button" onClick={onSend} aria-label="发送消息">
            <Send size={17} />
          </button>
        </div>
      </section>
    </div>
  )
}

function SocialView({
  state,
  parkingPending,
  onSteal,
  onPark,
  onClaimParking,
  onAddFriend,
  onSendGift,
  onVisit,
}: {
  state: AppState
  parkingPending: number
  onSteal: (cropId: string) => void
  onPark: (slotId: string) => void
  onClaimParking: () => void
  onAddFriend: (name: string) => Promise<boolean>
  onSendGift: (name: string) => void
  onVisit: () => void
}) {
  const [friendCode, setFriendCode] = useState('')
  const submitFriend = async () => {
    const added = await onAddFriend(friendCode)
    if (added) setFriendCode('')
  }

  return (
    <div className="screen-stack">
      <section className="panel friend-add-panel">
        <div className="section-title">
          <UserPlus size={19} />
          <h3>添加好友</h3>
        </div>
        <div className="friend-add-form">
          <input
            value={friendCode}
            maxLength={24}
            onChange={(event) => setFriendCode(event.target.value)}
            placeholder="输入好友邀请码"
          />
          <button type="button" onClick={submitFriend}>
            添加
          </button>
        </div>
      </section>

      <section className="friend-strip">
        {state.friends.length ? (
          state.friends.map((friend) => (
            <article className="friend-card" key={friend.id}>
              <button type="button" className="friend-visit" onClick={onVisit}>
                <span>{friend.name.slice(0, 1).toUpperCase()}</span>
                <b>{friend.name}</b>
                <small>{friend.userCode ?? '已添加'}</small>
              </button>
              <div className="friend-actions">
                <button type="button" onClick={onVisit}>
                  <Home size={14} />
                  拜访
                </button>
                <button type="button" onClick={() => onSendGift(friend.name)}>
                  <Gift size={14} />
                  赠礼
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-state">还没有好友，添加好友后可拜访、赠礼、收获农场。</p>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <Sprout size={19} />
          <h3>好友农场</h3>
        </div>
        <div className="crop-list">
          {state.friends.length ? (
            state.friends.map((friend) => {
              const cropKey = `${friend.id}:${friend.crop.id}`
              return (
                <button
                  type="button"
                  key={cropKey}
                  disabled={!friend.crop.ready || state.stolenCrops.includes(cropKey)}
                  onClick={() => onSteal(friend.id)}
                >
                  <Sprout size={18} />
                  <span>{friend.name}的{friend.crop.name}</span>
                  <b>{friend.crop.ready ? `+${friend.crop.reward}` : '成长中'}</b>
                </button>
              )
            })
          ) : (
            <p className="empty-state">好友农场会在添加好友后出现。</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <Car size={19} />
          <h3>抢车位</h3>
        </div>
        <div className="parking-income">
          <div>
            <span>当前车位</span>
            <b>{state.parkedSlot ? slots.find((slot) => slot.id === state.parkedSlot)?.name : '未停车'}</b>
          </div>
          <div>
            <span>可领收益</span>
            <b>{parkingPending} 金币</b>
          </div>
          <button type="button" onClick={onClaimParking} disabled={parkingPending <= 0}>领取</button>
        </div>
        <div className="slot-list">
          {slots.map((slot) => {
            const occupancy = state.parkingSlots?.[slot.id]
            const occupiedByOther = Boolean(occupancy?.occupied && !occupancy.occupiedByMe)
            return (
              <button
                type="button"
                key={slot.id}
                disabled={occupiedByOther}
                className={state.parkedSlot === slot.id ? 'selected' : ''}
                onClick={() => onPark(slot.id)}
              >
                <ParkingCircle size={18} />
                <span>{slot.name}</span>
                <b>{occupancy?.occupiedByMe ? '我的车位' : occupiedByOther ? '已占' : `${slot.rate}/小时`}</b>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function TasksView({
  tasks,
  onClaim,
}: {
  tasks: Array<{ id: string; title: string; reward: number; done: boolean; claimed: boolean }>
  onClaim: (taskId: string, reward: number) => void
}) {
  return (
    <div className="screen-stack">
      {tasks.map((task) => (
        <article className="task-row" key={task.id}>
          <div className={task.done ? 'task-icon done' : 'task-icon'}>
            {task.claimed ? <Check size={18} /> : <Star size={18} />}
          </div>
          <div>
            <h3>{task.title}</h3>
            <p>奖励金币 +{task.reward}</p>
          </div>
          <button type="button" disabled={!task.done || task.claimed} onClick={() => onClaim(task.id, task.reward)}>
            {task.claimed ? '已领' : '领取'}
          </button>
        </article>
      ))}
    </div>
  )
}

export default App
