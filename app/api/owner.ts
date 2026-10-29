import { getChatGPTUser } from '@/app/chatgpt-auth';

export async function getOwnerId() {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  if (process.env.NODE_ENV === 'development') return 'local-preview';
  return null;
}
