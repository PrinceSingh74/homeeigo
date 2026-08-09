import { useLocalSearchParams } from "expo-router";
import { HqScreenById } from "@/screens/hq-registry";

export default function HqDynamicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <HqScreenById id={id ?? ""} />;
}
