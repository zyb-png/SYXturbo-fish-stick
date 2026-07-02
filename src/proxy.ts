import { NextRequest, NextResponse } from 'next/server';

function isPageRequest(pathname: string) {
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return false;
  return !/\.[^/]+$/.test(pathname);
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  if (isPageRequest(request.nextUrl.pathname)) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
