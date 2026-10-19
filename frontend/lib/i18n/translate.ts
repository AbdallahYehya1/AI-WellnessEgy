import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import type { Locale } from "@/lib/i18n/config";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/onboarding/validation";

// Server actions return fixed English messages (asserted by tests and never
// built from user input). This table shows them in Arabic for Arabic visitors.
// Unknown messages are shown unchanged. Arabic is provisional (D-19).
const AR: Record<string, string> = {
  // Auth (lib/auth/errors.ts)
  "Choose a different password from the one you use now.": "اختار كلمة سر مختلفة عن اللي بتستخدمها دلوقتي.",
  "Creating new accounts is unavailable right now. Please try again later.": "إنشاء حسابات جديدة مش متاح دلوقتي. حاول تاني بعدين.",
  "Enter a valid email address, like name@example.com.": "اكتب بريد إلكتروني صحيح، زي name@example.com.",
  "Password reset isn't available right now. Please try again later.": "إعادة تعيين كلمة السر مش متاحة دلوقتي. حاول تاني بعدين.",
  "Please choose a stronger password: longer, and harder to guess.": "اختار كلمة سر أقوى: أطول وأصعب في التخمين.",
  "Please confirm your email address first. Check your inbox for the confirmation link.": "أكّد بريدك الإلكتروني الأول. شوف رسالة التأكيد في بريدك.",
  "Sign-in isn't available yet. Please try again later.": "تسجيل الدخول لسه مش متاح. حاول تاني بعدين.",
  "The email or password is incorrect.": "البريد الإلكتروني أو كلمة السر غلط.",
  "Too many attempts. Please wait a few minutes and try again.": "محاولات كتير. استنى كام دقيقة وحاول تاني.",
  "We couldn't create your account right now. Please try again.": "مقدرناش نعمل حسابك دلوقتي. حاول تاني.",
  "During testing, this app can only send email to approved test addresses. Please use your test account's email address.":
    "أثناء فترة الاختبار، التطبيق يقدر يبعت إيميلات لعناوين الاختبار المعتمدة بس. استخدم إيميل حساب الاختبار بتاعك.",
  "We couldn't send the reset email right now. Please try again in a few minutes.": "مقدرناش نبعت رسالة إعادة التعيين دلوقتي. حاول تاني بعد كام دقيقة.",
  "We couldn't sign you in right now. Please try again.": "مقدرناش ندخّلك دلوقتي. حاول تاني.",
  "We couldn't update your password right now. Please try again.": "مقدرناش نغيّر كلمة السر دلوقتي. حاول تاني.",
  // Validation (lib/auth/validation.ts)
  "Enter your email address.": "اكتب بريدك الإلكتروني.",
  "Enter your password.": "اكتب كلمة السر.",
  "That password is too long. Use a shorter one.": "كلمة السر طويلة قوي. استخدم واحدة أقصر.",
  "That password is too long.": "كلمة السر طويلة قوي.",
  "The passwords don't match.": "كلمتين السر مش زي بعض.",
  "You must be 18 or older to create an account.": "لازم يكون سنك ١٨ أو أكبر علشان تعمل حساب.",
  [`Use at least ${PASSWORD_MIN_LENGTH} characters.`]: `استخدم ${PASSWORD_MIN_LENGTH} حروف على الأقل.`,
  // Onboarding
  "Please confirm that you have read and agree to the terms.": "من فضلك أكّد إنك قريت الشروط ووافقت عليها.",
  "That name can't be used. Please try another.": "الاسم ده مينفعش. جرّب اسم تاني.",
  "The terms were updated while you were reading. Please review the new version.": "الشروط اتحدّثت وإنت بتقرا. راجع الإصدار الجديد من فضلك.",
  "We couldn't save this right now. Please try again.": "مقدرناش نحفظ ده دلوقتي. حاول تاني.",
  "The name contains characters that aren't allowed.": "الاسم فيه حروف مش مسموحة.",
  [`Use at most ${DISPLAY_NAME_MAX_LENGTH} characters.`]: `استخدم ${DISPLAY_NAME_MAX_LENGTH} حرف بالكتير.`,
  // Mood
  "Choose a number from 1 to 5.": "اختار رقم من ١ لـ ٥.",
  "We couldn't save your check-in right now. Please try again.": "مقدرناش نحفظ تسجيلك دلوقتي. حاول تاني.",
  // Chat
  "The assistant couldn't respond right now. Please try again.": "المساعد مقدرش يرد دلوقتي. حاول تاني.",
  "This conversation couldn't be verified. Please start over.": "مقدرناش نتأكد من المحادثة دي. ابدأ من جديد.",
  "Type a message first.": "اكتب رسالة الأول.",
  "The assistant has been switched off. Your message wasn't sent.": "المساعد اتقفل. رسالتك متبعتتش.",
  "The assistant isn't available for your account.": "المساعد مش متاح لحسابك.",
  "You're sending messages quickly. Please wait a minute.": "بتبعت رسايل بسرعة. استنى دقيقة.",
  [`Messages can be up to ${MAX_MESSAGE_CHARS} characters.`]: `الرسالة ممكن تكون لحد ${MAX_MESSAGE_CHARS} حرف.`,
};

export function translateMessage(locale: Locale, message: string): string;
export function translateMessage(locale: Locale, message: string | undefined): string | undefined;
export function translateMessage(locale: Locale, message: string | undefined): string | undefined {
  if (message === undefined || locale === "en") return message;
  return AR[message] ?? message;
}

/** For tests: every key, so a missing translation can be detected. */
export const TRANSLATED_MESSAGES = Object.keys(AR);
