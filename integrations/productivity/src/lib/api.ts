export const apiService = {
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response=await fetch(path.replace('/api/internal/scripts','/api/productivity-scripts'),{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options?.headers}});
    const result=await response.json();
    if(!response.ok)throw new Error(result.detail??'Script request unavailable');
    return result as T;
  },
};
