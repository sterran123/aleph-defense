// 제공 코드. 학생 업무 함수가 HTTP 오류를 알릴 때 이 클래스를 던집니다.
// 핸들러가 { error: { code, detail } } 본문과 status 로 바꿔 응답합니다.
export class ProductError extends Error {
  constructor(status, code, detail = '') {
    super(`${status} ${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'ProductError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (code, detail) => new ProductError(400, code, detail);
export const unauthorized = (code = 'login_required', detail) => new ProductError(401, code, detail);
export const forbidden = (code = 'forbidden', detail) => new ProductError(403, code, detail);
export const notFound = (code = 'not_found', detail) => new ProductError(404, code, detail);
export const conflict = (code, detail) => new ProductError(409, code, detail);
export const unprocessable = (code, detail) => new ProductError(422, code, detail);
export const notImplemented = name => new ProductError(501, 'not_implemented', name);
