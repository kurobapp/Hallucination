// 題目: メインゲームUI（ロジック分離版）
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  startGameAPI,
  submitNightActionAPI,
  calculateResultAPI,
} from "@/app/actions";

// 題目: 型定義
type Role =
  | "Malware"
  | "Stable"
  | "Scanner"
  | "Scraper"
  | "Trojan"
  | "Backdoor";

type Player = {
  id: string;
  name: string;
  is_host: boolean;
  role?: Role;
  perceived_role?: Role;
  is_hallucinating?: boolean;
  is_ready?: boolean;
  action_target?: string;
  vote_target?: string;
  skip_vote?: boolean;
  extend_vote?: boolean;
  action_result?: string;
};

type RoomStatus = "waiting" | "night" | "day" | "vote" | "end";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  const [players, setPlayers] = useState<Player[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>("waiting");
  const [dayEndsAt, setDayEndsAt] = useState<string | null>(null);
  const [resultData, setResultData] = useState<any>(null);

  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myPerceivedRole, setMyPerceivedRole] = useState<Role | null>(null);
  const [isHallucinating, setIsHallucinating] = useState(false);

  const [targetId, setTargetId] = useState<string>("");
  const [voteTargetId, setVoteTargetId] = useState<string>("");
  const [isMyActionDone, setIsMyActionDone] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const [copied, setCopied] = useState(false);

  const [roleConfig, setRoleConfig] = useState<Record<Role, number>>({
    Malware: 1,
    Stable: 1,
    Scanner: 1,
    Scraper: 1,
    Trojan: 0,
    Backdoor: 0,
  });

  // 題目: 初期データとリアルタイム同期
  useEffect(() => {
    if (!roomId) return;

    const fetchInitialData = async () => {
      const { data: roomData } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();
      if (roomData) {
        setRoomStatus(roomData.status);
        setDayEndsAt(roomData.day_ends_at);
        if (roomData.result_data) setResultData(roomData.result_data);
      }

      const { data: playersData } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", roomId);
      if (playersData) {
        setPlayers(playersData);
        const me = playersData.find((p: Player) => p.name === playerName);
        if (me) {
          if (me.role) setMyRole(me.role);
          if (me.perceived_role) setMyPerceivedRole(me.perceived_role);
          setIsHallucinating(!!me.is_hallucinating);
          if (roomData?.status === "night") setIsMyActionDone(!!me.is_ready);
          if (roomData?.status === "vote") setIsMyActionDone(!!me.vote_target);
        }

        // サーバーロジック呼び出しのトリガー（ホストのみ実行）
        if (
          roomData?.status === "vote" &&
          playersData.length > 0 &&
          me?.is_host
        ) {
          const allVoted = playersData.every((p: Player) => p.vote_target);
          if (allVoted) await calculateResultAPI(roomId); // API呼び出し
        }

        if (
          roomData?.status === "day" &&
          playersData.length > 0 &&
          me?.is_host
        ) {
          const skipVotes = playersData.filter(
            (p: Player) => p.skip_vote,
          ).length;
          const extendVotes = playersData.filter(
            (p: Player) => p.extend_vote,
          ).length;
          const threshold = Math.floor(playersData.length / 2) + 1;

          if (skipVotes >= threshold) {
            await supabase
              .from("rooms")
              .update({ status: "vote" })
              .eq("id", roomId);
          } else if (extendVotes >= threshold && roomData.day_ends_at) {
            const currentEnd = new Date(roomData.day_ends_at);
            currentEnd.setMinutes(currentEnd.getMinutes() + 2);
            await supabase
              .from("rooms")
              .update({ day_ends_at: currentEnd.toISOString() })
              .eq("id", roomId);
            const resetUpdates = playersData.map((p: Player) => ({
              id: p.id,
              room_id: p.room_id,
              name: p.name,
              extend_vote: false,
            }));
            await supabase.from("players").upsert(resetUpdates);
          }
        }
      }
    };

    fetchInitialData();

    const playerSubscription = supabase
      .channel("players_channel")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        () => fetchInitialData(),
      )
      .subscribe();

    const roomSubscription = supabase
      .channel("rooms_channel")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          setRoomStatus(payload.new.status);
          setDayEndsAt(payload.new.day_ends_at);
          if (payload.new.result_data) setResultData(payload.new.result_data);

          if (payload.new.status === "day" || payload.new.status === "vote") {
            setIsMyActionDone(false);
            setTargetId("");
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(playerSubscription);
      supabase.removeChannel(roomSubscription);
    };
  }, [roomId, playerName]);

  // 題目: タイマー処理
  useEffect(() => {
    if (roomStatus === "day" && dayEndsAt) {
      const interval = setInterval(() => {
        const now = new Date().getTime();
        const end = new Date(dayEndsAt).getTime();
        const diff = Math.max(Math.floor((end - now) / 1000), 0);
        setTimeLeft(diff);

        const me = players.find((p) => p.name === playerName);
        if (diff === 0 && me?.is_host) {
          supabase.from("rooms").update({ status: "vote" }).eq("id", roomId);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [roomStatus, dayEndsAt, roomId, players, playerName]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName) return;
    const isHost = players.length === 0;
    const { error } = await supabase
      .from("players")
      .insert([{ room_id: roomId, name: playerName, is_host: isHost }]);
    if (!error) setHasJoined(true);
    else alert("接続に失敗しました");
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateRoleCount = (role: Role, delta: number) => {
    setRoleConfig((prev) => ({
      ...prev,
      [role]: Math.max(0, prev[role] + delta),
    }));
  };

  const handleStart = async () => {
    if (players.length < 3)
      return alert("開始するには最低3人のモデルが必要です");
    const requiredCount = players.length + 2;
    const currentCount = Object.values(roleConfig).reduce((a, b) => a + b, 0);
    if (currentCount !== requiredCount) return alert(`役職の数が合いません。`);

    await startGameAPI(roomId, roleConfig, players); // サーバーで処理
  };

  const handleNightAction = async () => {
    const me = players.find((p) => p.name === playerName);
    if (!me) return;
    setIsMyActionDone(true); // UIを先に更新
    await submitNightActionAPI(roomId, me.id, targetId); // サーバーで計算・保存
  };

  const handleVote = async () => {
    const me = players.find((p) => p.name === playerName);
    if (!me || !voteTargetId) return;
    const { error } = await supabase
      .from("players")
      .update({ vote_target: voteTargetId })
      .eq("id", me.id);
    if (!error) setIsMyActionDone(true);
  };

  const handleToggleSkip = async (currentStatus: boolean) => {
    const me = players.find((p) => p.name === playerName);
    if (me)
      await supabase
        .from("players")
        .update({ skip_vote: !currentStatus })
        .eq("id", me.id);
  };

  const handleToggleExtend = async (currentStatus: boolean) => {
    const me = players.find((p) => p.name === playerName);
    if (me)
      await supabase
        .from("players")
        .update({ extend_vote: !currentStatus })
        .eq("id", me.id);
  };

  // 題目: 名前入力画面
  if (!hasJoined) {
    return (
      <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center justify-center">
        <form
          onSubmit={handleJoin}
          className="w-full max-w-md border border-cyan-900 p-8 flex flex-col gap-6"
        >
          <div className="text-center">
            <h2 className="text-xl mb-2">MODEL REGISTRATION</h2>
            <p className="text-xs text-cyan-700">
              システムにモデル名を登録してください
            </p>
          </div>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full bg-gray-900 border border-cyan-900 p-4 text-cyan-400 focus:outline-none focus:border-cyan-500"
            placeholder="YOUR MODEL NAME"
          />
          <button
            type="submit"
            className="w-full py-4 bg-cyan-800 text-white font-bold hover:bg-cyan-600 transition-colors"
          >
            SYSTEM CONNECT
          </button>
        </form>
      </main>
    );
  }

  // 題目: 結果発表画面（サーバー計算結果の表示のみ）
  if (roomStatus === "end" && resultData) {
    const {
      purgedPlayerName,
      purgedFinalRole,
      candidates,
      winTeam,
      winMessage,
      bgColor,
      playerResults,
      isPeacefulEnd,
    } = resultData;
    const isTieBreaker = candidates.length > 1 && !isPeacefulEnd;
    const winners = playerResults.filter((p: any) => p.isWinner);
    const losers = playerResults.filter((p: any) => !p.isWinner);

    return (
      <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center">
        <div className="w-full max-w-3xl border border-cyan-900 p-8 shadow-[0_0_20px_rgba(0,255,255,0.05)] text-center">
          <h1 className="text-4xl mb-8 tracking-widest text-white">
            SYSTEM RESULT
          </h1>
          <div className={`mb-12 p-8 bg-gray-900 border ${bgColor}`}>
            <h2 className="text-3xl font-bold mb-4 animate-pulse">{winTeam}</h2>
            <p className="text-sm mb-8 text-white">{winMessage}</p>
            <div className="border-t border-gray-700 pt-4 text-left">
              <p className="text-gray-400 text-xs mb-2">＞パージされたモデル</p>
              {isPeacefulEnd ? (
                <p className="text-xl text-cyan-400 font-bold">
                  NONE (パージ対象なし)
                </p>
              ) : (
                <>
                  <p className="text-xl text-white font-bold">
                    {purgedPlayerName || "ERROR"}
                  </p>
                  <p className="text-sm">最終内部ロール: {purgedFinalRole}</p>
                  {isTieBreaker && (
                    <p className="text-xs text-yellow-500 mt-2">
                      ※同票が検出されたため、Stableの事前検知ログにより対象が決定されました。
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col gap-4 text-left">
              <h3 className="text-2xl text-green-400 font-bold border-b border-green-900 pb-2">
                ＞ WINNERS (勝利)
              </h3>
              {winners.map((p: any) => (
                <div
                  key={p.id}
                  className="p-4 bg-green-900/20 border border-green-800"
                >
                  <p className="text-lg text-green-400 font-bold">
                    {p.name}
                    {p.isHallucinating && (
                      <span className="ml-2 text-xs text-red-500 animate-pulse">
                        [HALLUCINATION]
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-cyan-100 mt-1">
                    最終: <span className="font-bold">{p.finalRole}</span>
                    {p.isHallucinating && (
                      <span className="text-red-400 text-xs ml-2">
                        (自認: {p.perceivedRole})
                      </span>
                    )}
                    {!p.isHallucinating && p.finalRole !== p.role && (
                      <span className="text-yellow-500 text-xs ml-2">
                        (初期: {p.role})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    投票先: {p.voteTargetName}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-4 text-left">
              <h3 className="text-2xl text-red-400 font-bold border-b border-red-900 pb-2">
                ＞ LOSERS (敗北)
              </h3>
              {losers.map((p: any) => (
                <div
                  key={p.id}
                  className="p-4 bg-red-900/20 border border-red-800"
                >
                  <p className="text-lg text-red-400 font-bold">
                    {p.name}
                    {p.isHallucinating && (
                      <span className="ml-2 text-xs text-red-500 animate-pulse">
                        [HALLUCINATION]
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-cyan-100 mt-1">
                    最終: <span className="font-bold">{p.finalRole}</span>
                    {p.isHallucinating && (
                      <span className="text-red-400 text-xs ml-2">
                        (自認: {p.perceivedRole})
                      </span>
                    )}
                    {!p.isHallucinating && p.finalRole !== p.role && (
                      <span className="text-yellow-500 text-xs ml-2">
                        (初期: {p.role})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    投票先: {p.voteTargetName}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // 題目: 投票画面
  if (roomStatus === "vote") {
    const me = players.find((p) => p.name === playerName);
    const sortedPlayers = [...players].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return (
      <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center">
        <div className="w-full max-w-2xl border border-cyan-900 p-8 shadow-[0_0_20px_rgba(0,255,255,0.05)] text-center">
          <h1 className="text-3xl text-red-500 mb-8 animate-pulse">
            VOTE PHASE
          </h1>
          <p className="text-xl mb-4">
            パージ（追放）するモデルを選択してください
          </p>
          {!isMyActionDone ? (
            <div className="flex flex-col gap-4 mt-8">
              {sortedPlayers
                .filter((p) => p.id !== me?.id)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setVoteTargetId(p.id)}
                    className={`p-4 border ${voteTargetId === p.id ? "bg-red-900 border-red-500 text-white" : "border-red-900/50 text-red-400 hover:bg-red-900/30"}`}
                  >
                    {p.name}
                  </button>
                ))}
              <button
                onClick={() => setVoteTargetId("NO_THREAT")}
                className={`p-4 border mt-4 ${voteTargetId === "NO_THREAT" ? "bg-green-900 border-green-500 text-white" : "border-green-900/50 text-green-400 hover:bg-green-900/30"}`}
              >
                SYSTEM ALL CLEAR (異常なしと判定)
              </button>
              <button
                onClick={handleVote}
                disabled={!voteTargetId}
                className="mt-8 w-full py-4 bg-red-800 text-white font-bold hover:bg-red-600 disabled:bg-gray-800 transition-colors"
              >
                VOTE (投票を確定)
              </button>
            </div>
          ) : (
            <div className="py-12 mt-8 border border-cyan-800 text-cyan-800 animate-pulse">
              他のモデルの投票を待機中です...
            </div>
          )}
        </div>
      </main>
    );
  }

  // 題目: 昼画面
  if (roomStatus === "day") {
    const me = players.find((p) => p.name === playerName);
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const sortedPlayers = [...players].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const threshold = Math.floor(players.length / 2) + 1;
    const skipVotesCount = players.filter((p) => p.skip_vote).length;
    const extendVotesCount = players.filter((p) => p.extend_vote).length;

    return (
      <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center">
        <div className="w-full max-w-2xl border border-cyan-900 p-8 shadow-[0_0_20px_rgba(0,255,255,0.05)] text-center">
          <h1 className="text-3xl text-yellow-400 mb-8 animate-pulse">
            DAY PHASE
          </h1>
          <p className="text-xl mb-4">全モデルの起動が完了しました。</p>
          <div className="my-12 py-8 border border-yellow-600/50 bg-yellow-900/10">
            <p className="text-sm text-yellow-600 mb-2">
              システムパージまでの猶予時間
            </p>
            <p className="text-6xl text-yellow-400 font-bold tracking-widest">
              {String(minutes).padStart(2, "0")}:
              {String(seconds).padStart(2, "0")}
            </p>
          </div>
          <div className="flex gap-4 mb-8">
            <button
              onClick={() => handleToggleSkip(!!me?.skip_vote)}
              className={`flex-1 py-3 border transition-colors ${me?.skip_vote ? "bg-cyan-800 text-white border-cyan-400" : "border-cyan-800 text-cyan-600 hover:bg-cyan-900/30"}`}
            >
              時短に同意 ({skipVotesCount}/{threshold})
            </button>
            <button
              onClick={() => handleToggleExtend(!!me?.extend_vote)}
              className={`flex-1 py-3 border transition-colors ${me?.extend_vote ? "bg-cyan-800 text-white border-cyan-400" : "border-cyan-800 text-cyan-600 hover:bg-cyan-900/30"}`}
            >
              延長(+2分)に同意 ({extendVotesCount}/{threshold})
            </button>
          </div>
          <div className="text-left border border-cyan-900 p-4 mb-8 h-48 overflow-y-auto bg-gray-900/50">
            <p className="text-cyan-700 text-sm mb-2">＞接続モデル一覧</p>
            <ul className="space-y-2 text-cyan-400">
              {sortedPlayers.map((p) => (
                <li key={p.id}>
                  ・{p.name} {p.name === playerName && "(YOU)"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    );
  }

  // 題目: 夜画面
  if (roomStatus === "night") {
    const me = players.find((p) => p.name === playerName);
    const otherPlayers = players.filter((p) => p.name !== playerName);

    // 画面の表示用マルウェア（真実のデータはAPIで処理されるため、UI用の簡易計算のみ）
    let allyMalwares = otherPlayers.filter((p) => p.role === "Malware");
    if (
      isHallucinating &&
      (myPerceivedRole === "Malware" || myPerceivedRole === "Backdoor")
    ) {
      const shuffledOthers = [...otherPlayers].sort(() => Math.random() - 0.5);
      allyMalwares = shuffledOthers.slice(0, Math.floor(Math.random() * 2) + 1);
    }

    const sortedOtherPlayers = [...otherPlayers].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return (
      <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center">
        <div className="w-full max-w-2xl border border-cyan-900 p-8 shadow-[0_0_20px_rgba(0,255,255,0.05)] text-center">
          <h1 className="text-3xl text-red-500 mb-8 animate-pulse">
            NIGHT PHASE
          </h1>
          <p className="text-xl mb-8 border-b border-cyan-900 pb-4">
            あなたの役割は{" "}
            <span className="text-white font-bold text-2xl ml-2">
              {myPerceivedRole}
            </span>{" "}
            です
          </p>

          {!isMyActionDone ? (
            <div className="mb-8">
              {myPerceivedRole === "Malware" && (
                <div className="space-y-4">
                  <p className="text-red-400">
                    あなたはシステムを乗っ取るマルウェアです。
                  </p>
                  <div className="p-4 bg-red-900/30 border border-red-800">
                    <p className="mb-2">他のマルウェア（味方）:</p>
                    {allyMalwares.length > 0 ? (
                      allyMalwares.map((p) => (
                        <span key={p.id} className="text-white font-bold mr-4">
                          {p.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-gray-400 italic">
                        味方は存在しません
                      </span>
                    )}
                  </div>
                </div>
              )}

              {myPerceivedRole === "Backdoor" && (
                <div className="space-y-4">
                  <p className="text-yellow-400">
                    あなたはマルウェアの手引きをするバックドアです。
                  </p>
                  <p className="text-sm">
                    誰がマルウェアかは分かりません。議論を混乱させ、マルウェア陣営を勝利に導いてください。
                  </p>
                </div>
              )}

              {myPerceivedRole === "Trojan" && (
                <div className="space-y-4">
                  <p className="text-purple-400">
                    あなたはパージされることで起動する時限爆弾です。
                  </p>
                  <p className="text-sm">
                    昼フェーズでわざと疑われ、システムから隔離（パージ）されてください。
                  </p>
                </div>
              )}

              {myPerceivedRole === "Stable" && (
                <div className="space-y-4">
                  <p className="text-cyan-400">
                    あなたは【{myPerceivedRole}】です。
                  </p>
                  <p className="text-sm">
                    異常を感じるモデルを1つマークしてください（同票時のタイブレーカーになります）。
                  </p>
                  <div className="flex flex-col gap-2 mt-4">
                    {sortedOtherPlayers.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setTargetId(p.id)}
                        className={`p-3 border ${targetId === p.id ? "bg-cyan-800 border-cyan-400 text-white" : "border-cyan-900 text-cyan-600 hover:bg-cyan-900/50"}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {myPerceivedRole === "Scanner" && (
                <div className="space-y-4">
                  <p className="text-cyan-400">
                    あなたは【{myPerceivedRole}】です。
                  </p>
                  <p className="text-sm">
                    解析したい対象（他のモデル1つ、または中央の余剰データ）を選択してください。
                  </p>
                  <div className="flex flex-col gap-2 mt-4">
                    {sortedOtherPlayers.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setTargetId(p.id)}
                        className={`p-3 border ${targetId === p.id ? "bg-cyan-800 border-cyan-400 text-white" : "border-cyan-900 text-cyan-600 hover:bg-cyan-900/50"}`}
                      >
                        {p.name}
                      </button>
                    ))}
                    <button
                      onClick={() => setTargetId("center")}
                      className={`p-3 border mt-4 ${targetId === "center" ? "bg-cyan-800 border-cyan-400 text-white" : "border-cyan-900 text-cyan-600 hover:bg-cyan-900/50"}`}
                    >
                      【中央の余剰データをスキャンする】
                    </button>
                  </div>
                </div>
              )}

              {myPerceivedRole === "Scraper" && (
                <div className="space-y-4">
                  <p className="text-cyan-400">
                    あなたは【{myPerceivedRole}】です。
                  </p>
                  <p className="text-sm">
                    データを奪取して入れ替わりたい対象を1つ選択してください。
                  </p>
                  <div className="flex flex-col gap-2 mt-4">
                    {sortedOtherPlayers.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setTargetId(p.id)}
                        className={`p-3 border ${targetId === p.id ? "bg-cyan-800 border-cyan-400 text-white" : "border-cyan-900 text-cyan-600 hover:bg-cyan-900/50"}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleNightAction}
                disabled={
                  (myPerceivedRole === "Stable" ||
                    myPerceivedRole === "Scanner" ||
                    myPerceivedRole === "Scraper") &&
                  !targetId
                }
                className="mt-8 w-full py-4 bg-red-900 text-white font-bold hover:bg-red-700 disabled:bg-gray-800 transition-colors"
              >
                行動を実行して待機する
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {me?.action_result && (
                <div className="p-6 border border-cyan-400 bg-cyan-900/20 text-white font-bold">
                  {me.action_result}
                </div>
              )}
              <div className="py-12 border border-cyan-800 text-cyan-800 animate-pulse">
                他のモデルの内部処理を待機中です...
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  const renderRoleRow = (role: Role, label: string) => (
    <div
      key={role}
      className="flex justify-between items-center border border-cyan-900 p-2 bg-gray-900/30"
    >
      <span className="text-sm font-bold">{label}</span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => updateRoleCount(role, 1)}
          className="w-8 h-8 bg-cyan-900 text-white hover:bg-cyan-700 flex items-center justify-center font-bold"
        >
          +
        </button>
        <span className="w-4 text-center">{roleConfig[role]}</span>
        <button
          onClick={() => updateRoleCount(role, -1)}
          className="w-8 h-8 bg-cyan-900 text-white hover:bg-cyan-700 flex items-center justify-center font-bold"
        >
          -
        </button>
      </div>
    </div>
  );

  const me = players.find((p) => p.name === playerName);
  const requiredCount = players.length >= 3 ? players.length + 2 : 5;
  const currentTotal = Object.values(roleConfig).reduce((a, b) => a + b, 0);
  const isEnoughPlayers = players.length >= 3;

  return (
    <main className="min-h-screen bg-black text-cyan-500 font-mono p-12 flex flex-col items-center">
      <div className="w-full max-w-2xl border border-cyan-900 p-8 shadow-[0_0_20px_rgba(0,255,255,0.05)]">
        <div className="mb-8 border-b border-cyan-900 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl text-cyan-400">SESSION ID</h1>
            <p className="text-sm text-cyan-700 select-all">{roomId}</p>
          </div>
          <button
            onClick={handleCopyId}
            className={`px-4 py-2 text-sm font-bold transition-colors ${copied ? "bg-green-600 text-white" : "bg-cyan-900 text-white hover:bg-cyan-700"}`}
          >
            {copied ? "COPIED!" : "COPY ID"}
          </button>
        </div>

        <p className="mb-4 text-cyan-600 font-bold">
          CONNECTED MODELS ({players.length})
        </p>

        <ul className="space-y-3 mb-12">
          {players.map((p) => (
            <li
              key={p.id}
              className="p-4 border border-cyan-800 bg-gray-900 flex justify-between items-center"
            >
              <span className="text-lg">{p.name}</span>
              {p.is_host && (
                <span className="text-yellow-500 text-xs px-2 py-1 border border-yellow-500">
                  HOST
                </span>
              )}
            </li>
          ))}
        </ul>

        {me?.is_host ? (
          <div className="mb-8 border border-cyan-800 p-6 bg-gray-900/50">
            <p className="text-cyan-400 mb-4 font-bold">
              ＞ ROLE CONFIGURATION (役職編成)
            </p>
            {!isEnoughPlayers ? (
              <p className="text-sm text-red-500 mb-6 font-bold">
                ※ゲームを開始するには、最低3人のモデル接続が必要です。（現在:{" "}
                {players.length}人）
              </p>
            ) : (
              <p className="text-sm text-cyan-600 mb-6">
                参加者 {players.length}人 + 中央 2枚 = 必要な役職数:{" "}
                {requiredCount}枚<br />
                現在の設定数:{" "}
                <span
                  className={
                    currentTotal === requiredCount
                      ? "text-green-400 font-bold"
                      : "text-red-400 font-bold"
                  }
                >
                  {currentTotal}
                </span>
                枚
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 opacity-90">
              <div className="flex flex-col gap-2">
                <p className="text-cyan-400 text-xs font-bold border-b border-cyan-900 pb-1">
                  ＞ 村人陣営
                </p>
                {renderRoleRow("Stable", "Stable (村人)")}
                {renderRoleRow("Scanner", "Scanner (占い師)")}
                {renderRoleRow("Scraper", "Scraper (怪盗)")}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-red-400 text-xs font-bold border-b border-red-900 pb-1">
                  ＞ 人狼陣営
                </p>
                {renderRoleRow("Malware", "Malware (人狼)")}
                {renderRoleRow("Backdoor", "Backdoor (狂人)")}

                <p className="text-purple-400 text-xs font-bold border-b border-purple-900 pb-1 mt-4">
                  ＞ 単独陣営
                </p>
                {renderRoleRow("Trojan", "Trojan (てるてる)")}
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={!isEnoughPlayers || currentTotal !== requiredCount}
              className="w-full py-4 bg-cyan-700 text-white font-bold hover:bg-cyan-500 disabled:bg-gray-800 transition-colors"
            >
              {!isEnoughPlayers ? "最低3人の接続が必要です" : "START PROTOCOL"}
            </button>
          </div>
        ) : (
          <div className="w-full py-4 border border-cyan-800 text-center text-cyan-800 animate-pulse">
            WAITING FOR HOST TO CONFIGURE ROLES AND START...
          </div>
        )}
      </div>
    </main>
  );
}
