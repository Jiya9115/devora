import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        long target = Long.parseLong(st.nextToken());
        st = new StringTokenizer(br.readLine());
        HashMap<Long, Integer> seen = new HashMap<>();
        for (int i = 0; i < n; i++) {
            long v = Long.parseLong(st.nextToken());
            Integer j = seen.get(target - v);
            if (j != null) { System.out.println(j + " " + i); return; }
            seen.put(v, i);
        }
        System.out.println(-1);
    }
}
