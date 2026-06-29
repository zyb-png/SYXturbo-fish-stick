import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'MM钰汐，一站式工作流。',
    template: '%s | 扣子编程',
  },
  description:
    '上传故事文件，自动提取大纲、生成分镜脚本、创作图片分镜与视频。一站式AI视频创作平台。',
  keywords: [
    'AI视频生成',
    '故事分镜',
    '图片分镜',
    '视频创作',
    '自动化视频',
    '扣子编程',
    'Coze Code',
  ],
  authors: [{ name: 'Coze Code Team', url: 'https://code.coze.cn' }],
  generator: 'Coze Code',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: 'MM钰汐，一站式工作流。',
    description:
      '上传故事文件，自动提取大纲、生成分镜脚本、创作图片分镜与视频。',
    url: 'https://code.coze.cn',
    siteName: 'MM钰汐，一站式工作流。',
    locale: 'zh_CN',
    type: 'website',
    // images: [
    //   {
    //     url: '',
    //     width: 1200,
    //     height: 630,
    //     alt: '扣子编程 - 你的 AI 工程师',
    //   },
    // ],
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Coze Code | Your AI Engineer is Here',
  //   description:
  //     'Build and deploy full-stack applications through AI conversation. No env setup, just flow.',
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased">
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
