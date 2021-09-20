export const badResponse = (message: string) => ({
  status: 404,
  body: { error: message },
});

export const ok = (body?: string) => ({
  status: 200,
  body
});
