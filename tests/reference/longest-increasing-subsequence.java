import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        StringTokenizer st = new StringTokenizer(br.readLine());
        long[] t = new long[n];
        int len = 0;
        for (int i = 0; i < n; i++) {
            long x = Long.parseLong(st.nextToken());
            int lo = 0, hi = len;
            while (lo < hi) { int m = (lo + hi) >>> 1; if (t[m] < x) lo = m + 1; else hi = m; }
            t[lo] = x;
            if (lo == len) len++;
        }
        System.out.println(len);
    }
}
