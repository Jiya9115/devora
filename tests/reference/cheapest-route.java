import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        DataInputStream in = new DataInputStream(new BufferedInputStream(System.in, 1 << 16));
        int n = (int) next(in), m = (int) next(in);
        int[] head = new int[n + 1], nxt = new int[2 * m], to = new int[2 * m];
        long[] w = new long[2 * m];
        Arrays.fill(head, -1);
        int e = 0;
        for (int i = 0; i < m; i++) {
            int u = (int) next(in), v = (int) next(in);
            long c = next(in);
            to[e] = v; w[e] = c; nxt[e] = head[u]; head[u] = e++;
            to[e] = u; w[e] = c; nxt[e] = head[v]; head[v] = e++;
        }
        long[] dist = new long[n + 1];
        Arrays.fill(dist, Long.MAX_VALUE);
        dist[1] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        pq.add(new long[]{0, 1});
        while (!pq.isEmpty()) {
            long[] top = pq.poll();
            int u = (int) top[1];
            if (top[0] > dist[u]) continue;
            for (int k = head[u]; k != -1; k = nxt[k]) {
                long nd = top[0] + w[k];
                if (nd < dist[to[k]]) { dist[to[k]] = nd; pq.add(new long[]{nd, to[k]}); }
            }
        }
        System.out.println(dist[n] == Long.MAX_VALUE ? -1 : dist[n]);
    }
    static long next(DataInputStream in) throws IOException {
        int c = in.read();
        while (c <= ' ') c = in.read();
        long r = 0;
        while (c > ' ') { r = r * 10 + (c - '0'); c = in.read(); }
        return r;
    }
}
