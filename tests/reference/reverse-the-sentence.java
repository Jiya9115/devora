import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        String line = new BufferedReader(new InputStreamReader(System.in)).readLine();
        String[] w = line.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (int i = w.length - 1; i >= 0; i--) { sb.append(w[i]); if (i > 0) sb.append(' '); }
        System.out.println(sb);
    }
}
