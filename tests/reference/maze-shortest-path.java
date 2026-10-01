import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int R = Integer.parseInt(st.nextToken()), C = Integer.parseInt(st.nextToken());
        char[][] g = new char[R][];
        int s = -1;
        for (int i = 0; i < R; i++) {
            g[i] = br.readLine().trim().toCharArray();
            for (int j = 0; j < C; j++) if (g[i][j] == 'S') s = i * C + j;
        }
        int[] dist = new int[R * C];
        Arrays.fill(dist, -1);
        int[] q = new int[R * C];
        int h = 0, t = 0;
        q[t++] = s; dist[s] = 0;
        int[] di = {1, -1, 0, 0}, dj = {0, 0, 1, -1};
        while (h < t) {
            int cur = q[h++], i = cur / C, j = cur % C;
            if (g[i][j] == 'E') { System.out.println(dist[cur]); return; }
            for (int k = 0; k < 4; k++) {
                int a = i + di[k], b = j + dj[k];
                if (a < 0 || b < 0 || a >= R || b >= C || g[a][b] == '#' || dist[a * C + b] != -1) continue;
                dist[a * C + b] = dist[cur] + 1;
                q[t++] = a * C + b;
            }
        }
        System.out.println(-1);
    }
}
