import { useEvent } from 'expo';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Header, Loading, Screen, T } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { useServerInfo, useTopic } from '@/lib/hooks';
import { stop as stopAudio } from '@/lib/player';
import { keys, queryClient } from '@/lib/query';
import { space } from '@/theme';

/** Video with native controls and fullscreen. Resumes where you left off and saves as it plays. */
export default function Watch() {
  const { id, rid } = useLocalSearchParams<{ id: string; rid: string }>();
  const topic = useTopic(id);
  const server = useServerInfo();
  const resource = topic.data?.topic.resources.find((r) => r.id === rid);
  const token = server.data?.file_token;
  if (!resource || !token || !topic.data) {
    return (
      <Screen header={<Header title="Video" />}>
        <Loading />
      </Screen>
    );
  }
  const saved = topic.data.progress.items[rid];
  return (
    <VideoScreen
      topicId={id}
      rid={rid}
      title={resource.title}
      topicTitle={topic.data.topic.title}
      url={fileUrl(token, `topics/${id}/${resource.path}`)}
      startAt={saved && !saved.done ? saved.position : 0}
    />
  );
}

function VideoScreen(props: {
  topicId: string;
  rid: string;
  title: string;
  topicTitle: string;
  url: string;
  startAt: number;
}) {
  const lastSave = useRef(0);
  const player = useVideoPlayer(props.url, (p) => {
    p.timeUpdateEventInterval = 1;
    if (props.startAt) p.currentTime = props.startAt;
    p.play();
  });
  const time = useEvent(player, 'timeUpdate');
  const status = useEvent(player, 'playToEnd');

  useEffect(() => stopAudio(), []);

  const save = (done?: boolean) => {
    lastSave.current = Date.now();
    void api
      .saveProgress(props.topicId, {
        resource_id: props.rid,
        position: player.currentTime,
        duration: player.duration || null,
        done: done || undefined,
        updated: new Date().toISOString(),
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (time && Date.now() - lastSave.current > 10_000) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  useEffect(() => {
    if (status !== undefined && status !== null) {
      save(true);
      void queryClient.invalidateQueries({ queryKey: keys.topic(props.topicId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(
    () => () => {
      save();
      void queryClient.invalidateQueries({ queryKey: keys.topic(props.topicId) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <Screen header={<Header title={props.title} subtitle={props.topicTitle} />} scroll={false} wide>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#000' }}>
        <VideoView
          player={player}
          style={{ width: '100%', aspectRatio: 16 / 9 }}
          nativeControls
          fullscreenOptions={{ enable: true }}
        />
      </View>
      <View style={{ padding: space.md }}>
        <T variant="meta" tone="lead">
          Your place is saved as you watch.
        </T>
      </View>
    </Screen>
  );
}
