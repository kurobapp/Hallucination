"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  const [joinId, setJoinId] = useState("");
  const [loading, setLoading] = useState(false);

  // ルーム作成処理
  const createRoom = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rooms")
      .insert([{ status: "waiting" }])
      .select()
      .single();

    if (error) {
      alert("システムエラー：部屋の生成に失敗しました");
      setLoading(false);
      return;
    }
    router.push(`/room/${data.id}`);
  };

  // ルーム参加処理
  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinId) return;
    router.push(`/room/${joinId}`);
  };

  return (
    <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center justify-center">
      <div className="w-full max-w-md border border-cyan-900 p-8 shadow-[0_0_30px_rgba(0,255,255,0.1)]">
        <h1 className="text-4xl font-bold mb-10 text-center tracking-widest text-cyan-400">
          HALLUCINATION
        </h1>

        <button
          onClick={createRoom}
          disabled={loading}
          className="w-full py-4 bg-cyan-800 text-white font-bold hover:bg-cyan-600 disabled:bg-gray-800 mb-8 transition-colors"
        >
          {loading ? "INITIALIZING..." : "CREATE NEW SESSION"}
        </button>

        <div className="border-t border-cyan-900 my-6"></div>

        <form onSubmit={joinRoom} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="ENTER SESSION ID"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            className="w-full bg-gray-900 border border-cyan-900 p-4 text-cyan-400 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="w-full py-3 border border-cyan-800 hover:bg-cyan-900 transition-colors"
          >
            JOIN SESSION
          </button>
        </form>
      </div>
    </main>
  );
}
