const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type HealthResponse = {
    status: string;
    service: string;
    environment:string,
    mongodb:string;
    timestamp:string;
}

export async function fetchHealth() {
    const res = await fetch(`${API_URL}/api/health`, {cache: "no-store"});
    if(!res.ok){
        throw new Error(`Health Check failed: ${res.status}`);
    }
    return res.json();
}